const express = require("express");
const { PKPass } = require("passkit-generator");
const fs = require("fs");
const path = require("path");
const { v4: uuidv4 } = require("uuid");

const app = express();
const PORT = 3000;

/*
Simple coupon storage
*/
const couponsPath = path.join(__dirname, "coupons.json");

let coupons = {};

if (fs.existsSync(couponsPath)) {
    coupons = JSON.parse(fs.readFileSync(couponsPath));
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

        // 🔥 READ ORIGINAL TEMPLATE
        let passData = JSON.parse(fs.readFileSync(passJsonPath));

        // 🔥 FORCE UNIQUE PASS
        passData.serialNumber = id;
        passData.authenticationToken = id;

        // 🔥 WRITE TEMP CHANGES
        fs.writeFileSync(passJsonPath, JSON.stringify(passData, null, 2));

        // 🔥 CREATE PASS
        const pass = await PKPass.from({
            model: modelPath,
            certificates: {
                wwdr: fs.readFileSync("certs/wwdr.pem"),
                signerCert: fs.readFileSync("certs/passCert.pem"),
                signerKey: fs.readFileSync("certs/passKey.pem"),
                signerKeyPassphrase: "password"
            }
        });

        // ensure arrays exist
        pass.fields = pass.fields || {};

pass.fields.primaryFields = pass.fields.primaryFields || [];
pass.fields.secondaryFields = pass.fields.secondaryFields || [];

pass.fields.primaryFields.push({
    key: "offer",
    label: "",
    value: couponText
});

pass.fields.secondaryFields.push({
    key: "from",
    label: "From",
    value: from
});
        

        // main coupon
        pass.primaryFields.push({
            key: "offer",
            label: "",
            value: couponText
        });

        // from
        pass.secondaryFields.push({
            key: "from",
            label: "From",
            value: from
        });

    

        // QR code
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


app.listen(PORT, () => {
    console.log("Coupon server running on port " + PORT);
});