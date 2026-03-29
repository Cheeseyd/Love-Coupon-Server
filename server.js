// 🔥 FINAL SERVER (WORKING — CORRECT TYPE + FIELDS + QR + PUSH)

const express = require("express");
const { PKPass } = require("passkit-generator");
const fs = require("fs");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const apn = require("apn");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

/*
JSON STORAGE
*/
const DATA_PATH = "/var/data/coupons.json";

let coupons = {};

try {
    if (fs.existsSync(DATA_PATH)) {
        coupons = JSON.parse(fs.readFileSync(DATA_PATH, "utf8") || "{}");
    }
} catch {
    coupons = {};
}

function saveCoupons() {
    fs.writeFileSync(DATA_PATH, JSON.stringify(coupons, null, 2));
}

/*
APNs
*/
const apnProvider = new apn.Provider({
    token: {
        key: path.join(__dirname, "certs/AuthKey.p8"),
        keyId: "YOUR_KEY_ID",
        teamId: "62V445535C"
    },
    production: false
});

/*
ROOT
*/
app.get("/", (req, res) => res.send("OK"));

/*
CREATE PASS
*/
app.get("/coupon", async (req, res) => {
    try {
        const couponText = req.query.text || "Free Hug";
        const from = req.query.from || "Someone ❤️";
        const id = uuidv4();

        const token = uuidv4().replace(/-/g, "") + uuidv4().replace(/-/g, "");

        coupons[id] = {
            text: couponText,
            fromName: from,
            used: false,
            token
        };
        saveCoupons();

        const pass = await PKPass.from({
            model: path.join(__dirname, "model.pass"),
            certificates: {
                wwdr: fs.readFileSync(path.join(__dirname, "certs/wwdr.pem")),
                signerCert: fs.readFileSync(path.join(__dirname, "certs/passCert.pem")),
                signerKey: fs.readFileSync(path.join(__dirname, "certs/passKey.pem")),
                signerKeyPassphrase: "password"
            }
        });

        // ✅ CORRECT TYPE
        pass.setType("generic");

        pass.serialNumber = id;
        pass.authenticationToken = token;
        pass.webServiceURL = "https://love-coupon-server.onrender.com";
        pass.description = "Coupon";
        pass.logoText = " ";

        // ✅ FIELDS
        pass.primaryFields = [
            { key: "offer", label: "Coupon", value: couponText }
        ];

        pass.secondaryFields = [
            { key: "from", label: "From", value: from }
        ];

        pass.auxiliaryFields = [
            { key: "status", label: "", value: "Valid" }
        ];

        const qr = `https://love-coupon-server.onrender.com/redeem/${id}`;

        pass.setBarcodes({
            format: "PKBarcodeFormatQR",
            message: qr,
            messageEncoding: "iso-8859-1"
        });

        pass.barcode = {
            format: "PKBarcodeFormatQR",
            message: qr,
            messageEncoding: "iso-8859-1"
        };

        res.set({ "Content-Type": "application/vnd.apple.pkpass" });
        res.send(pass.getAsBuffer());

    } catch (err) {
        console.log("CREATE ERROR:", err);
        res.status(500).send(err.toString());
    }
});

/*
REGISTER DEVICE
*/
app.post("/v1/devices/:deviceLibraryIdentifier/registrations/:passTypeIdentifier/:serialNumber", (req, res) => {
    const { deviceLibraryIdentifier, serialNumber } = req.params;
    const pushToken = req.body.pushToken;

    console.log("🔥 REGISTERED DEVICE");

    if (coupons[serialNumber]) {
        coupons[serialNumber].deviceLibraryIdentifier = deviceLibraryIdentifier;
        coupons[serialNumber].pushToken = pushToken;
        saveCoupons();
    }

    res.sendStatus(201);
});

/*
CHECK UPDATES
*/
app.get("/v1/devices/:deviceLibraryIdentifier/registrations/:passTypeIdentifier", (req, res) => {
    const updated = Object.entries(coupons)
        .filter(([_, c]) => c.used)
        .map(([id]) => id);

    res.json({
        serialNumbers: updated,
        lastUpdated: new Date().toISOString()
    });
});

/*
SERVE UPDATED PASS
*/
app.get("/v1/passes/:passTypeIdentifier/:serialNumber", async (req, res) => {
    const { serialNumber } = req.params;

    const coupon = coupons[serialNumber];
    if (!coupon) return res.sendStatus(404);

    const pass = await PKPass.from({
        model: path.join(__dirname, "model.pass"),
        certificates: {
            wwdr: fs.readFileSync(path.join(__dirname, "certs/wwdr.pem")),
            signerCert: fs.readFileSync(path.join(__dirname, "certs/passCert.pem")),
            signerKey: fs.readFileSync(path.join(__dirname, "certs/passKey.pem")),
            signerKeyPassphrase: "password"
        }
    });

    pass.setType("generic");

    pass.serialNumber = serialNumber;
    pass.authenticationToken = coupon.token;
    pass.webServiceURL = "https://love-coupon-server.onrender.com";
    pass.description = "Coupon";
    pass.logoText = " ";

    pass.primaryFields = [
        {
            key: "offer",
            label: "Coupon",
            value: coupon.used ? "USED ❤️" : coupon.text
        }
    ];

    pass.secondaryFields = [
        { key: "from", label: "From", value: coupon.fromName }
    ];

    pass.auxiliaryFields = [
        {
            key: "status",
            label: "",
            value: coupon.used ? "Redeemed" : "Valid"
        }
    ];

    if (coupon.used) {
        pass.voided = true;
    }

    const qr = `https://love-coupon-server.onrender.com/redeem/${serialNumber}`;

    pass.setBarcodes({
        format: "PKBarcodeFormatQR",
        message: qr,
        messageEncoding: "iso-8859-1"
    });

    pass.barcode = {
        format: "PKBarcodeFormatQR",
        message: qr,
        messageEncoding: "iso-8859-1"
    };

    res.set({ "Content-Type": "application/vnd.apple.pkpass" });
    res.send(pass.getAsBuffer());
});

/*
REDEEM
*/
app.get("/redeem/:id", async (req, res) => {
    const coupon = coupons[req.params.id];

    if (!coupon) return res.send("Invalid coupon");
    if (coupon.used) return res.send("Already used ❤️");

    coupon.used = true;
    saveCoupons();

    if (coupon.pushToken) {
        const note = new apn.Notification();
        note.topic = "pass.com.dillybarproductions.coupons";
        note.contentAvailable = 1;

        try {
            await apnProvider.send(note, coupon.pushToken);
            console.log("🚀 Push sent");
        } catch (err) {
            console.log("Push error:", err);
        }
    }

    res.send(`Redeemed: ${coupon.text}`);
});

app.listen(PORT, "0.0.0.0", () => {
    console.log("Running on port", PORT);
});