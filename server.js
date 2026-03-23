const express = require("express");
const { PKPass } = require("passkit-generator");
const fs = require("fs");
const path = require("path");
const { v4: uuidv4 } = require("uuid");

const app = express();
const PORT = process.env.PORT || 3000;

/*
Simple coupon storage (SAFE)
*/
const couponsPath = path.join(__dirname, "coupons.json");

let coupons = {};

try {
    if (fs.existsSync(couponsPath)) {
        const data = fs.readFileSync(couponsPath, "utf8").trim();
        coupons = data ? JSON.parse(data) : {};
    }
} catch {
    coupons = {};
}

/*
Generate coupon pass
*/
app.get("/coupon", async (req, res) => {

    const couponText = req.query.text || "Free Hug";
    const from = req.query.from || "Someone ❤️";

    const id = uuidv4();

    coupons[id] = {
        text: couponText,
        from: from,
        used: false
    };

    fs.writeFileSync(couponsPath, JSON.stringify(coupons, null, 2));

    try {

        const modelPath = path.join(__dirname, "model.pass");
        const passJsonPath = path.join(modelPath, "pass.json");

        // READ TEMPLATE
        let passData = JSON.parse(fs.readFileSync(passJsonPath, "utf8"));

        // UNIQUE PASS
        passData.serialNumber = id;
        passData.authenticationToken = id;

        // SET FIELDS
        passData.generic = passData.generic || {};
        passData.generic.primaryFields = [
            { key: "offer", label: "", value: couponText }
        ];
        passData.generic.secondaryFields = [
            { key: "from", label: "From", value: from }
        ];

        // WRITE TEMP CHANGES
        fs.writeFileSync(passJsonPath, JSON.stringify(passData, null, 2));

        // CREATE PASS
        const pass = await PKPass.from({
            model: modelPath,
            certificates: {
                wwdr: fs.readFileSync(path.join(__dirname, "certs/wwdr.pem")),
                signerCert: fs.readFileSync(path.join(__dirname, "certs/passCert.pem")),
                signerKey: fs.readFileSync(path.join(__dirname, "certs/passKey.pem")),
                signerKeyPassphrase: "password"
            }
        });

        // QR
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
        console.log("PASS ERROR:");
        console.log(err);
        res.status(500).send(err.toString());
    }

});

/*
Redeem coupon
*/
app.get("/redeem/:id", (req, res) => {

    const id = req.params.id;

    if (!coupons[id]) {
        return res.send("Invalid coupon");
    }

    if (coupons[id].used) {
        return res.send("Coupon already redeemed ❤️");
    }

    coupons[id].used = true;

    fs.writeFileSync(couponsPath, JSON.stringify(coupons, null, 2));

    res.send(`Coupon Redeemed ❤️: ${coupons[id].text}`);

});

app.get("/", (req, res) => {
    res.send("Server running");
});

app.listen(PORT, () => {
    console.log("Coupon server running on port " + PORT);
});