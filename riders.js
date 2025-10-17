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


// ===================== GET AVAILABLE DELIVERIES =====================
router.get("/available-deliveries", async (req, res) => {
  try {
    const [rows] = await db.execute(`
      SELECT 
        d.delivery_id,
        d.delivery_status,
        d.product_image,
        d.pickup_address,
        ST_X(d.pickup_gps) AS pickup_lon,
        ST_Y(d.pickup_gps) AS pickup_lat,
        d.dropoff_address,
        ST_X(d.dropoff_gps) AS dropoff_lon,
        ST_Y(d.dropoff_gps) AS dropoff_lat,
        d.created_at,

        -- Sender
        s.user_id AS sender_id,
        s.name AS sender_name,
        s.phone_number AS sender_phone,
        s.user_image AS sender_image,
        s.address AS sender_address,
        ST_X(s.gps_location) AS sender_lon,
        ST_Y(s.gps_location) AS sender_lat,

        -- Receiver
        d.receiver_phone_number,
        rcv.name AS receiver_name,
        rcv.user_image AS receiver_image,
        rcv.address AS receiver_address,
        ST_X(rcv.gps_location) AS receiver_lon,
        ST_Y(rcv.gps_location) AS receiver_lat

      FROM Deliveries d
      LEFT JOIN Users s ON d.sender_id = s.user_id
      LEFT JOIN Users rcv ON d.receiver_phone_number = rcv.phone_number
      WHERE d.rider_id IS NULL
        AND d.delivery_status = 'รอไรเดอร์มารับสินค้า'
      ORDER BY d.created_at DESC
    `);

    // ดึงรายการสินค้าที่อยู่ใน Multi_Item_Orders
    for (const d of rows) {
      const [items] = await db.execute(
        `SELECT order_id, item_description, item_image 
         FROM Multi_Item_Orders 
         WHERE delivery_id = ?`,
        [d.delivery_id]
      );
      d.items = items;
    }

    res.json({
      total: rows.length,
      deliveries: rows,
    });
  } catch (err) {
    console.error("Error fetching available deliveries:", err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
});

// ✅ UPDATE delivery status
router.put('/deliveries/:id/status', async (req, res) => {
  try {
    const { id } = req.params; // delivery_id
    const { delivery_status, rider_id } = req.body;

    if (!delivery_status)
      return res.status(400).json({ message: 'ต้องระบุ delivery_status' });

    // ✅ เริ่ม transaction
    const connection = await db.getConnection();
    await connection.beginTransaction();

    try {
      // ✅ อัปเดตสถานะใน Deliveries
      let sql = `UPDATE Deliveries SET delivery_status = ?`;
      const params = [delivery_status];

      if (rider_id) {
        sql += `, rider_id = ?`;
        params.push(rider_id);
      }

      sql += ` WHERE delivery_id = ?`;
      params.push(id);

      await connection.execute(sql, params);

      // ✅ ถ้ามี rider_id → set availability_status = FALSE
      if (rider_id) {
        await connection.execute(
          `UPDATE Riders SET availability_status = FALSE WHERE rider_id = ?`,
          [rider_id]
        );
      }

      // ✅ commit
      await connection.commit();
      connection.release();

      res.json({
        message: 'อัปเดตสถานะสำเร็จ',
        updated_delivery_id: id,
        rider_id: rider_id || null,
        delivery_status,
      });
    } catch (err) {
      await connection.rollback();
      connection.release();
      console.error('update status transaction error:', err);
      res.status(500).json({ message: 'Transaction error', error: err.message });
    }
  } catch (err) {
    console.error('update status error', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});




module.exports = router;



