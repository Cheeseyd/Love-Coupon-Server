// 🔥 FINAL CLEAN SERVER (WORKING — SIMPLE + RELIABLE)

const express = require("express");
const { PKPass } = require("passkit-generator");
const fs = require("fs");
const path = require("path");
const { v4: uuidv4 } = require("uuid");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

/*
JSON STORAGE
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

        const token = uuidv4().replace(/-/g, "") + uuidv4().replace(/-/g, "");

        coupons[id] = {
            text: couponText,
            fromName: from,
            used: false,
            token
        };
        saveCoupons();

        const pass = await PKPass.from({
            model: path.join(__dirname, "model.pass"),
            certificates: {
                wwdr: fs.readFileSync(path.join(__dirname, "certs/wwdr.pem")),
                signerCert: fs.readFileSync(path.join(__dirname, "certs/passCert.pem")),
                signerKey: fs.readFileSync(path.join(__dirname, "certs/passKey.pem")),
                signerKeyPassphrase: "password"
            }
        });

        pass.serialNumber = id;
        pass.authenticationToken = token;
        pass.webServiceURL = "https://love-coupon-server.onrender.com";

        // ✅ THIS IS THE REAL FIX
        pass.generic = {
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

        const qr = `https://love-coupon-server.onrender.com/redeem/${id}`;

        pass.setBarcodes({
            format: "PKBarcodeFormatQR",
            message: qr,
            messageEncoding: "iso-8859-1"
        });

        res.set({ "Content-Type": "application/vnd.apple.pkpass" });
        res.send(pass.getAsBuffer());

    } catch (err) {
        console.log("CREATE ERROR:", err);
        res.status(500).send(err.toString());
    }
});

/*
REDEEM (simple for now)
*/
app.get("/redeem/:id", (req, res) => {
    const coupon = coupons[req.params.id];

    if (!coupon) return res.send("Invalid coupon");
    if (coupon.used) return res.send("Already used ❤️");

    coupon.used = true;
    saveCoupons();

    res.send(`Redeemed: ${coupon.text}`);
});

app.listen(PORT, "0.0.0.0", () => {
    console.log("Running on port", PORT);
});