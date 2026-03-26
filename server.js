// 🔥 FULL SERVER WITH APPLE WALLET LIVE UPDATES (MINIMAL WORKING SETUP)

const express = require("express");
const { PKPass } = require("passkit-generator");
const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");
const { v4: uuidv4 } = require("uuid");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

/*
DATABASE
*/
const db = new Database("/var/data/coupons.db");

db.prepare(`
CREATE TABLE IF NOT EXISTS coupons (
    id TEXT PRIMARY KEY,
    text TEXT,
    fromName TEXT,
    used INTEGER,
    deviceLibraryIdentifier TEXT,
    pushToken TEXT
)
`).run();

/*
ROOT
*/
app.get("/", (req, res) => {
    res.send("OK");
});

/*
CREATE PASS
*/
app.get("/coupon", async (req, res) => {
    try {
        const couponText = req.query.text || "Free Hug";
        const from = req.query.from || "Someone ❤️";
        const id = uuidv4();

        db.prepare(
            "INSERT INTO coupons (id, text, fromName, used) VALUES (?, ?, ?, 0)"
        ).run(id, couponText, from);

        const modelPath = path.join(__dirname, "model.pass");
        const passJsonPath = path.join(modelPath, "pass.json");

        let passData = JSON.parse(fs.readFileSync(passJsonPath, "utf8"));

        passData.serialNumber = id;
        passData.authenticationToken = id;
        passData.webServiceURL = "https://love-coupon-server.onrender.com";
        passData.logoText = " ";
        passData.description = "Coupon";

        passData.generic = passData.generic || {};
        passData.generic.primaryFields = [
            { key: "offer", label: "", value: couponText }
        ];
        passData.generic.secondaryFields = [
            { key: "from", label: "From", value: from }
        ];

        fs.writeFileSync(passJsonPath, JSON.stringify(passData, null, 2));

        const pass = await PKPass.from({
            model: modelPath,
            certificates: {
                wwdr: fs.readFileSync(path.join(__dirname, "certs/wwdr.pem")),
                signerCert: fs.readFileSync(path.join(__dirname, "certs/passCert.pem")),
                signerKey: fs.readFileSync(path.join(__dirname, "certs/passKey.pem")),
                signerKeyPassphrase: "password"
            }
        });

        pass.setBarcodes({
            format: "PKBarcodeFormatQR",
            message: `https://love-coupon-server.onrender.com/redeem/${id}`,
            messageEncoding: "iso-8859-1"
        });

        res.set({
            "Content-Type": "application/vnd.apple.pkpass"
        });

        res.send(pass.getAsBuffer());

    } catch (err) {
        console.log(err);
        res.status(500).send(err.toString());
    }
});

/*
REGISTER DEVICE (Wallet calls this)
*/
app.post("/v1/devices/:deviceLibraryIdentifier/registrations/:passTypeIdentifier/:serialNumber", (req, res) => {
    const { deviceLibraryIdentifier, serialNumber } = req.params;
    const pushToken = req.body.pushToken;

    db.prepare(`
        UPDATE coupons
        SET deviceLibraryIdentifier = ?, pushToken = ?
        WHERE id = ?
    `).run(deviceLibraryIdentifier, pushToken, serialNumber);

    res.sendStatus(201);
});

/*
GET UPDATED PASSES
*/
app.get("/v1/devices/:deviceLibraryIdentifier/registrations/:passTypeIdentifier", (req, res) => {
    const updated = db.prepare(`
        SELECT id FROM coupons WHERE used = 1
    `).all();

    res.json({
        serialNumbers: updated.map(c => c.id),
        lastUpdated: new Date().toISOString()
    });
});

/*
SERVE UPDATED PASS
*/
app.get("/v1/passes/:passTypeIdentifier/:serialNumber", async (req, res) => {
    const { serialNumber } = req.params;

    const coupon = db.prepare("SELECT * FROM coupons WHERE id = ?").get(serialNumber);

    if (!coupon) return res.sendStatus(404);

    const modelPath = path.join(__dirname, "model.pass");
    const passJsonPath = path.join(modelPath, "pass.json");

    let passData = JSON.parse(fs.readFileSync(passJsonPath, "utf8"));

    passData.serialNumber = serialNumber;
    passData.authenticationToken = serialNumber;
    passData.webServiceURL = "https://love-coupon-server.onrender.com";
    passData.logoText = " ";
    passData.description = "Coupon";

    passData.generic.primaryFields = [
        {
            key: "offer",
            label: "",
            value: coupon.used ? "USED ❤️" : coupon.text
        }
    ];

    passData.generic.secondaryFields = [
        { key: "from", label: "From", value: coupon.fromName }
    ];

    if (coupon.used) {
        passData.voided = true;
    }

    fs.writeFileSync(passJsonPath, JSON.stringify(passData, null, 2));

    const pass = await PKPass.from({
        model: modelPath,
        certificates: {
            wwdr: fs.readFileSync(path.join(__dirname, "certs/wwdr.pem")),
            signerCert: fs.readFileSync(path.join(__dirname, "certs/passCert.pem")),
            signerKey: fs.readFileSync(path.join(__dirname, "certs/passKey.pem")),
            signerKeyPassphrase: "password"
        }
    });

    res.set({
        "Content-Type": "application/vnd.apple.pkpass"
    });

    res.send(pass.getAsBuffer());
});

/*
REDEEM (TRIGGERS UPDATE)
*/
app.get("/redeem/:id", (req, res) => {
    const id = req.params.id;

    const coupon = db.prepare("SELECT * FROM coupons WHERE id = ?").get(id);

    if (!coupon) return res.send("Invalid coupon");
    if (coupon.used) return res.send("Already used ❤️");

    db.prepare("UPDATE coupons SET used = 1 WHERE id = ?").run(id);

    // 🔥 HERE is where you'd send APNs push (advanced)
    console.log("Coupon used → should trigger push update");

    res.send(`Redeemed: ${coupon.text}`);
});

app.listen(PORT, "0.0.0.0", () => {
    console.log("Running on port", PORT);
});