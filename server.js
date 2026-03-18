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
let coupons = {};


/*
Generate coupon pass
*/
app.get("/coupon", async (req, res) => {

    const couponText = req.query.text || "Free Hug";
    const from = req.query.from || "Someone ❤️";

    const id = uuidv4();
    const authToken = uuidv4();

    coupons[id] = {
        text: couponText,
        from: from,
        used: false
    };

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

        // 🔥 FORCE UNIQUE PASS (this is the real fix)
        pass.serialNumber = id;
        pass.authenticationToken = authToken;

        // ALSO override inside raw data (important)
        pass.passJSON.serialNumber = id;
        pass.passJSON.authenticationToken = authToken;

        // make sure arrays exist
        pass.primaryFields = pass.primaryFields || [];
        pass.secondaryFields = pass.secondaryFields || [];
        pass.auxiliaryFields = pass.auxiliaryFields || [];

        pass.primaryFields.push({
            key: "offer",
            label: "Love Coupon",
            value: couponText
        });

        pass.secondaryFields.push({
            key: "from",
            label: "From",
            value: from
        });

        pass.auxiliaryFields.push({
            key: "id",
            label: "Code",
            value: id.slice(0, 8)
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

    res.send(`Coupon Redeemed ❤️: ${coupons[id].text}`);

});


app.listen(PORT, () => {
    console.log("Coupon server running on port " + PORT);
});