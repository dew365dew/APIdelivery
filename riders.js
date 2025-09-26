// riders.js
const express = require("express");
const router = express.Router();
const db = require("./db");
const bcrypt = require("bcrypt");

// REGISTER Rider
router.post("/register", async (req, res) => {
  try {
    const { phone_number, password, name, rider_image, vehicle_registration, current_location } = req.body;
    if (!phone_number || !password || !name || !vehicle_registration) {
      return res.status(400).json({ message: "กรอกข้อมูลไม่ครบ" });
    }

    const password_hash = await bcrypt.hash(password, 10);

    // แปลง current_location เป็น point
    let point = null;
    if (current_location) {
      const [lng, lat] = current_location.split(" ").map(Number);
      point = [lng, lat];
    }

    const [result] = await db.execute(
      `INSERT INTO Riders (phone_number, password, name, rider_image, vehicle_registration, current_location) 
       VALUES (?, ?, ?, ?, ?, POINT(?, ?))`,
      [
        phone_number,
        password_hash,
        name,
        rider_image || null,
        vehicle_registration,
        point ? point[0] : null,
        point ? point[1] : null,
      ]
    );

    res.status(201).json({ message: "สมัคร Rider สำเร็จ", rider_id: result.insertId });
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ message: "เบอร์โทรนี้ถูกใช้แล้ว" });
    }
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});


// LOGIN Rider
router.post("/login", async (req, res) => {
  try {
    const { phone_number, password } = req.body;
    if (!phone_number || !password) {
      return res.status(400).json({ message: "ต้องกรอกเบอร์โทรและรหัสผ่าน" });
    }

    const [rows] = await db.execute(`SELECT * FROM Riders WHERE phone_number = ?`, [phone_number]);
    const rider = rows[0];
    if (!rider) return res.status(401).json({ message: "ไม่พบ Rider" });

    const match = await bcrypt.compare(password, rider.password);
    if (!match) return res.status(401).json({ message: "รหัสผ่านไม่ถูกต้อง" });

    res.json({
      message: "เข้าสู่ระบบ Rider สำเร็จ",
      rider: {
        rider_id: rider.rider_id,
        phone_number: rider.phone_number,
        name: rider.name,
        vehicle_registration: rider.vehicle_registration,
        rider_image: rider.rider_image,
        current_location: rider.current_location, // เหมือน User ส่ง gps_location
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});



module.exports = router;
