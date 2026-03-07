const express = require("express");
const { PKPass } = require("passkit-generator");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = 3000;

app.get("/coupon", async (req, res) => {

    const couponText = req.query.text || "Free Hug";

    try {

        const pass = await PKPass.from({
            model: path.join(__dirname, "model.pass"),
            certificates: {
                wwdr: fs.readFileSync("certs/wwdr.pem"),
                signerCert: fs.readFileSync("certs/passCert.pem"),
                signerKey: fs.readFileSync("certs/passKey.pem"),
                signerKeyPassphrase: "password"
            }
        });

        pass.primaryFields.push({
            key: "offer",
            label: "Love Coupon",
            value: couponText
        });

        res.set({
            "Content-Type": "application/vnd.apple.pkpass",
            "Content-Disposition": "attachment; filename=coupon.pkpass"
        });

        res.send(pass.getAsBuffer());

    } catch (err) {
    console.log("PASS ERROR:");
    console.log(err);
    res.status(500).send(err.toString());
}

});

app.listen(PORT, () => {
    console.log("Coupon server running on port " + PORT);
});