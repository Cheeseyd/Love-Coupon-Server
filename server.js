const express = require("express");
const { PKPass } = require("passkit-generator");
const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");
const { v4: uuidv4 } = require("uuid");

const app = express();
const PORT = process.env.PORT || 3000;

/*
DATABASE (RENDER DISK REQUIRED)
*/
const db = new Database("/var/data/coupons.db");

db.prepare(`
CREATE TABLE IF NOT EXISTS coupons (
    id TEXT PRIMARY KEY,
    text TEXT,
    fromName TEXT,
    used INTEGER
)
`).run();

/*
ROOT
*/
app.get("/", (req, res) => {
    res.send("OK");
});

/*
Generate coupon
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
            "Content-Type": "application/vnd.apple.pkpass",
            "Content-Disposition": "attachment; filename=coupon.pkpass"
        });

        res.send(pass.getAsBuffer());

    } catch (err) {
        console.log("CRASH:", err);
        res.status(500).send(err.toString());
    }
});

/*
Redeem coupon
*/
app.get("/redeem/:id", (req, res) => {
    const id = req.params.id;

    const row = db.prepare("SELECT * FROM coupons WHERE id = ?").get(id);

    if (!row) return res.send("Invalid coupon");
    if (row.used) return res.send("Already used ❤️");

    db.prepare("UPDATE coupons SET used = 1 WHERE id = ?").run(id);

    res.send(`Redeemed: ${row.text}`);
});

app.listen(PORT, "0.0.0.0", () => {
    console.log("Running on port", PORT);
});