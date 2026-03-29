const express = require("express");
const { PKPass } = require("passkit-generator");
const fs = require("fs");
const path = require("path");
const { v4: uuidv4 } = require("uuid");

const app = express();
const PORT = process.env.PORT || 3000;

/*
Simple storage
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
CREATE PASS
*/
app.get("/coupon", async (req, res) => {
    try {
        const couponText = req.query.text || "Free Hug";
        const from = req.query.from || "Someone ❤️";
        const id = uuidv4();

        coupons[id] = {
            text: couponText,
            from: from,
            used: false
        };
        saveCoupons();

        const modelPath = path.join(__dirname, "model.pass");
        const originalPath = path.join(modelPath, "pass.json");

        // ✅ CLONE TEMPLATE (DO NOT OVERWRITE ORIGINAL)
        let passData = JSON.parse(fs.readFileSync(originalPath, "utf8"));

        passData.serialNumber = id;
        passData.authenticationToken = id.replace(/-/g, "") + "123456";
        passData.webServiceURL = "https://love-coupon-server.onrender.com";

        passData.description = "Coupon";
        passData.logoText = "Love Coupon";

        // ✅ THIS IS THE KEY (THIS WORKS 100%)
        passData.generic = {
            primaryFields: [
                {
                    key: "offer",
                    label: "Coupon",
                    value: couponText
                }
            ],
            secondaryFields: [
                {
                    key: "from",
                    label: "From",
                    value: from
                }
            ]
        };

        // 🔥 WRITE TO TEMP FILE (NOT ORIGINAL)
        const tempPath = path.join(__dirname, `temp-${id}.pass`);
        fs.mkdirSync(tempPath);
        fs.writeFileSync(
            path.join(tempPath, "pass.json"),
            JSON.stringify(passData, null, 2)
        );

        // copy images
        fs.readdirSync(modelPath).forEach(file => {
            if (file !== "pass.json") {
                fs.copyFileSync(
                    path.join(modelPath, file),
                    path.join(tempPath, file)
                );
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

        res.set({
            "Content-Type": "application/vnd.apple.pkpass"
        });

        res.send(pass.getAsBuffer());

        // cleanup temp
        fs.rmSync(tempPath, { recursive: true, force: true });

    } catch (err) {
        console.log("ERROR:", err);
        res.status(500).send(err.toString());
    }
});

/*
REDEEM
*/
app.get("/redeem/:id", (req, res) => {
    const coupon = coupons[req.params.id];

    if (!coupon) return res.send("Invalid coupon");
    if (coupon.used) return res.send("Already used ❤️");

    coupon.used = true;
    saveCoupons();

    res.send(`Redeemed: ${coupon.text}`);
});

app.listen(PORT, () => {
    console.log("Running on port", PORT);
});