const express = require("express");
const { PKPass } = require("passkit-generator");
const fs = require("fs");
const path = require("path");
const { v4: uuidv4 } = require("uuid");

const app = express();
const PORT = process.env.PORT || 3000;

/*
NO STORAGE (just to get server working again)
*/
let coupons = {};

/*
ROOT TEST (CRITICAL)
*/
app.get("/", (req, res) => {
    res.send("SERVER WORKING");
});

/*
TEST ROUTE
*/
app.get("/test", (req, res) => {
    res.send("TEST OK");
});

/*
Generate coupon pass
*/
app.get("/coupon", async (req, res) => {
    try {
        const couponText = req.query.text || "Free Hug";
        const from = req.query.from || "Someone ❤️";
        const id = uuidv4();

        coupons[id] = { text: couponText, from, used: false };

        const modelPath = path.join(__dirname, "model.pass");

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

    if (!coupons[id]) return res.send("Invalid coupon");
    if (coupons[id].used) return res.send("Already used ❤️");

    coupons[id].used = true;
    res.send(`Redeemed: ${coupons[id].text}`);
});

app.listen(PORT, "0.0.0.0", () => {
    console.log("Running on port", PORT);
});