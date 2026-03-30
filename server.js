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
STORAGE
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
APN (PUSH)
*/
const apnProvider = new apn.Provider({
    token: {
        key: "certs/AuthKey.p8",
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

        coupons[id] = {
            text: couponText,
            from,
            used: false,
            pushToken: null
        };
        saveCoupons();

        const modelPath = path.join(__dirname, "model.pass");
        const base = JSON.parse(fs.readFileSync(path.join(modelPath, "pass.json"), "utf8"));

        base.serialNumber = id;
        base.authenticationToken = id.replace(/-/g, "") + "123456";
        base.webServiceURL = "https://love-coupon-server.onrender.com";

        base.generic = {
            primaryFields: [
                { key: "offer", label: "Coupon", value: couponText }
            ],
            secondaryFields: [
                { key: "from", label: "From", value: from || "Someone ❤️" }
            ]
        };

        const tempPath = path.join(__dirname, `temp-${id}.pass`);
        fs.mkdirSync(tempPath);

        fs.writeFileSync(
            path.join(tempPath, "pass.json"),
            JSON.stringify(base, null, 2)
        );

        fs.readdirSync(modelPath).forEach(f => {
            if (f !== "pass.json") {
                fs.copyFileSync(path.join(modelPath, f), path.join(tempPath, f));
            }
        });

        const pass = await PKPass.from({
            model: tempPath,
            certificates: {
                wwdr: fs.readFileSync("certs/wwdr.pem"),
                signerCert: fs.readFileSync("certs/passCert.pem"),
                signerKey: fs.readFileSync("certs/passKey.pem"),
                signerKeyPassphrase: "password"
            }
        });

        pass.setBarcodes({
            format: "PKBarcodeFormatQR",
            message: `https://love-coupon-server.onrender.com/redeem/${id}`,
            messageEncoding: "iso-8859-1"
        });

        res.set({ "Content-Type": "application/vnd.apple.pkpass" });
        res.send(pass.getAsBuffer());

        fs.rmSync(tempPath, { recursive: true, force: true });

    } catch (err) {
        console.log("CREATE ERROR:", err);
        res.status(500).send(err.toString());
    }
});

/*
REGISTER DEVICE (for push)
*/
app.post("/v1/devices/:deviceLibraryIdentifier/registrations/:passTypeIdentifier/:serialNumber", (req, res) => {
    const { serialNumber } = req.params;
    const pushToken = req.body.pushToken;

    console.log("🔥 REGISTERED DEVICE");

    if (coupons[serialNumber]) {
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

    console.log("📡 Wallet checking →", updated);

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

    const modelPath = path.join(__dirname, "model.pass");
    const base = JSON.parse(fs.readFileSync(path.join(modelPath, "pass.json"), "utf8"));

    base.serialNumber = serialNumber;
    base.authenticationToken = serialNumber.replace(/-/g, "") + "123456";
    base.webServiceURL = "https://love-coupon-server.onrender.com";

    base.generic = {
        primaryFields: [
            {
                key: "offer",
                label: "Coupon",
                value: coupon.used ? "USED ❤️" : coupon.text
            }
        ],
        secondaryFields: [
            {
                key: "from",
                label: "From",
                value: coupon.from || "Someone ❤️"
            }
        ]
    };

    if (coupon.used) {
        base.voided = true;
        base.expirationDate = new Date(Date.now() - 1000).toISOString();
    }

    const tempPath = path.join(__dirname, `temp-${serialNumber}.pass`);
    fs.mkdirSync(tempPath);

    fs.writeFileSync(
        path.join(tempPath, "pass.json"),
        JSON.stringify(base, null, 2)
    );

    fs.readdirSync(modelPath).forEach(f => {
        if (f !== "pass.json") {
            fs.copyFileSync(path.join(modelPath, f), path.join(tempPath, f));
        }
    });

    const pass = await PKPass.from({
        model: tempPath,
        certificates: {
            wwdr: fs.readFileSync("certs/wwdr.pem"),
            signerCert: fs.readFileSync("certs/passCert.pem"),
            signerKey: fs.readFileSync("certs/passKey.pem"),
            signerKeyPassphrase: "password"
        }
    });

    // ✅ KEEP QR ON UPDATE
    pass.setBarcodes({
        format: "PKBarcodeFormatQR",
        message: `https://love-coupon-server.onrender.com/redeem/${serialNumber}`,
        messageEncoding: "iso-8859-1"
    });

    res.set({ "Content-Type": "application/vnd.apple.pkpass" });
    res.send(pass.getAsBuffer());

    fs.rmSync(tempPath, { recursive: true, force: true });
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

/*
DELETE (FROM APP)
*/
app.get("/delete/:id", async (req, res) => {
    const coupon = coupons[req.params.id];

    if (!coupon) return res.send("Not found");

    coupon.used = true;
    saveCoupons();

    if (coupon.pushToken) {
        const note = new apn.Notification();
        note.topic = "pass.com.dillybarproductions.coupons";
        note.contentAvailable = 1;

        try {
            await apnProvider.send(note, coupon.pushToken);
            console.log("🚀 Push sent (delete)");
        } catch (err) {
            console.log("Push error:", err);
        }
    }

    res.send("Deleted");
});

/*
LIST COUPONS (FOR APP)
*/
app.get("/coupons", (req, res) => {
    const list = Object.entries(coupons).map(([id, c]) => ({
        id,
        text: c.text,
        from: c.from,
        used: c.used
    }));

    res.json(list);
});

/*
START
*/
app.listen(PORT, () => {
    console.log("Running on port", PORT);
});