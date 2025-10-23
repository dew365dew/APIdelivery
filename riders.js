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

// ✅ UPDATE delivery status (เช็คก่อนว่า rider ว่างหรือไม่)
// ✅ UPDATE delivery status (เช็คก่อนว่า rider ว่างหรือไม่ และปลดว่างเมื่อส่งเสร็จ)
router.put('/deliveries/:id/status', async (req, res) => {
  try {
    const { id } = req.params; // delivery_id
    const { delivery_status, rider_id } = req.body;

    if (!delivery_status)
      return res.status(400).json({ message: 'ต้องระบุ delivery_status' });

    // ✅ ถ้ามี rider_id ต้องเช็คว่า rider ว่างหรือไม่
    if (rider_id) {
      const [riderRows] = await db.execute(
        `SELECT availability_status FROM Riders WHERE rider_id = ?`,
        [rider_id]
      );

      if (riderRows.length === 0) {
        return res.status(404).json({ message: 'ไม่พบข้อมูลไรเดอร์นี้' });
      }

      const isAvailable = riderRows[0].availability_status;

      // ❌ ถ้าไรเดอร์ไม่ว่าง และสถานะไม่ใช่ “นำส่งสินค้าแล้ว” → ห้ามรับงานใหม่
      if (!isAvailable && delivery_status !== 'ไรเดอร์นำส่งสินค้าแล้ว') {
        return res.status(400).json({
          message: '❌ ไรเดอร์ไม่ว่าง ไม่สามารถรับงานใหม่ได้',
        });
      }
    }

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

      // ✅ ถ้ามี rider_id
      if (rider_id) {
        if (delivery_status === 'ไรเดอร์นำส่งสินค้าแล้ว') {
          // ➕ ปลดสถานะให้ว่าง (TRUE)
          await connection.execute(
            `UPDATE Riders SET availability_status = TRUE WHERE rider_id = ?`,
            [rider_id]
          );
        } else {
          // ➖ ถ้ากำลังทำงานอยู่ ให้ไม่ว่าง (FALSE)
          await connection.execute(
            `UPDATE Riders SET availability_status = FALSE WHERE rider_id = ?`,
            [rider_id]
          );
        }
      }

      await connection.commit();
      connection.release();

      res.json({
        message: '✅ อัปเดตสถานะสำเร็จ',
        updated_delivery_id: id,
        rider_id: rider_id || null,
        delivery_status,
      });
    } catch (err) {
      await connection.rollback();
      connection.release();
      console.error('update status transaction error:', err);
      res.status(500).json({
        message: 'Transaction error',
        error: err.message,
      });
    }
  } catch (err) {
    console.error('update status error', err);
    res.status(500).json({
      message: 'Server error',
      error: err.message,
    });
  }
});



// ===================== GET ALL DELIVERIES ASSIGNED TO RIDER =====================
router.get("/my-deliveries/:rider_id", async (req, res) => {
  try {
    const { rider_id } = req.params;

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
      WHERE d.rider_id = ?
      ORDER BY d.created_at DESC
    `, [rider_id]);

    // ✅ ดึงรายการสินค้าจาก Multi_Item_Orders
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
    console.error("Error fetching rider deliveries:", err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
});



// ✅ UPDATE Rider Current Location
router.put("/:rider_id/location", async (req, res) => {
  try {
    const { rider_id } = req.params;
    const { lon, lat } = req.body;

    if (lon === undefined || lat === undefined) {
      return res.status(400).json({ message: "ต้องระบุพิกัด lon และ lat" });
    }

    const [result] = await db.execute(
      `UPDATE Riders SET current_location = ST_GeomFromText(?) WHERE rider_id = ?`,
      [`POINT(${lon} ${lat})`, rider_id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "ไม่พบ Rider ที่ระบุ" });
    }

    res.json({
      message: "อัปเดตตำแหน่งปัจจุบันของ Rider สำเร็จ",
      rider_id,
      current_location: { lon, lat },
    });
  } catch (err) {
    console.error("Error updating rider location:", err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
});



// ✅ GET Rider Current Location
router.get("/:rider_id/location", async (req, res) => {
  try {
    const { rider_id } = req.params;

    // ดึงพิกัดจาก MySQL (ใช้ ST_X และ ST_Y แยกค่า lon/lat จาก POINT)
    const [rows] = await db.execute(
      `SELECT 
          ST_X(current_location) AS lon, 
          ST_Y(current_location) AS lat 
        FROM Riders 
        WHERE rider_id = ?`,
      [rider_id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ message: "ไม่พบ Rider ที่ระบุ" });
    }

    res.json({
      rider_id,
      current_location: {
        lon: rows[0].lon,
        lat: rows[0].lat,
      },
    });
  } catch (err) {
    console.error("Error fetching rider location:", err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
});


module.exports = router;









