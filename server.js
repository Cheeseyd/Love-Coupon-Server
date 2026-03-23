const express = require("express");
const { PKPass } = require("passkit-generator");
const fs = require("fs");
const path = require("path");
const { v4: uuidv4 } = require("uuid");

const app = express();
const PORT = process.env.PORT || 3000;

let coupons = {};

/*
ROOT
*/
app.get("/", (req, res) => {
    res.send("OK");
});

/*
Generate coupon pass (FIXED)
*/
app.get("/coupon", async (req, res) => {
    try {
        const couponText = req.query.text || "Free Hug";
        const from = req.query.from || "Someone ❤️";
        const id = uuidv4();

        coupons[id] = { text: couponText, from, used: false };

        const modelPath = path.join(__dirname, "model.pass");
        const passJsonPath = path.join(modelPath, "pass.json");

        // 🔥 FIX pass.json BEFORE building
        let passData = JSON.parse(fs.readFileSync(passJsonPath, "utf8"));

        passData.serialNumber = id;
        passData.authenticationToken = id;

        // REQUIRED FIXES
        passData.logoText = " "; // cannot be empty
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
Redeem
*/
app.get("/redeem/:id", (req, res) => {
    const id = req.params.id;

    if (!coupons[id]) return res.send("Invalid coupon");
    if (coupons[id].used) return res.send("Already used ❤️");

    coupons[id].used = true;
    res.send(`Redeemed: ${coupons[id].text}`);
});

app.listen(PORT, "0.0.0.0", () => {
    console.log("Running on port", PORT);
});