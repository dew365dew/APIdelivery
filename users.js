// users.js
const express = require("express");
const router = express.Router();
const db = require("./db");
const bcrypt = require("bcrypt");

// REGISTER User
// REGISTER User
router.post("/register", async (req, res) => {
  try {
    // เปลี่ยนชื่อ field ให้ตรงกับ Flutter (camelCase)
    const { phoneNumber, password, name, userImage, address, gpsLocation, userType } = req.body;

    if (!phoneNumber || !password || !name || !userType) {
      return res.status(400).json({ message: "กรอกข้อมูลไม่ครบ" });
    }

    const password_hash = await bcrypt.hash(password, 10);

    // แปลง GPS ถ้ามี
    let point = null;
    if (gpsLocation && gpsLocation.includes(" ")) {
      const [lng, lat] = gpsLocation.split(" ").map(Number);
      if (!isNaN(lng) && !isNaN(lat)) {
        point = [lng, lat];
      }
    }

    const [result] = await db.execute(
      `INSERT INTO Users (phone_number, password, name, user_image, address, gps_location, user_type)
       VALUES (?, ?, ?, ?, ?, ${point ? "POINT(?, ?)" : "NULL"}, ?)`,
      [
        phoneNumber,
        password_hash,
        name,
        userImage || null,
        address || null,
        ...(point ? [point[0], point[1]] : []),
        userType
      ]
    );

    res.status(201).json({ message: "สมัครสมาชิกสำเร็จ", user_id: result.insertId });
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ message: "เบอร์โทรนี้ถูกใช้แล้ว" });
    }
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});



// LOGIN User
router.post("/login", async (req, res) => {
  try {
    const { phone_number, password } = req.body;
    if (!phone_number || !password) {
      return res.status(400).json({ message: "ต้องกรอกเบอร์โทรและรหัสผ่าน" });
    }

    const [rows] = await db.execute(`SELECT * FROM Users WHERE phone_number = ?`, [phone_number]);
    const user = rows[0];
    if (!user) return res.status(401).json({ message: "ไม่พบบัญชีนี้" });

    const match = await bcrypt.compare(password, user.password);


 //console.log(`Password sent: "${password}"`);
    if (!match) return res.status(401).json({     message: "รหัสผ่านไม่ถูกต้อง" });

    res.json({
      message: "เข้าสู่ระบบสำเร็จ",
      user: {
        user_id: user.user_id,
        phone_number: user.phone_number,
        name: user.name,
        user_type: user.user_type,
        user_image: user.user_image,
        address: user.address,
        gps_location: user.gps_location,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

// SEARCH User by phone number
router.get("/search/:phone_number", async (req, res) => {
  try {
    const { phone_number } = req.params;
    const [rows] = await db.execute(`SELECT * FROM Users WHERE phone_number = ?`, [phone_number]);
    if (rows.length === 0) return res.status(404).json({ message: "ไม่พบผู้ใช้" });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;

