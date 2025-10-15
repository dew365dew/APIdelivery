// users.js
const express = require("express");
const router = express.Router();
const db = require("./db");
const bcrypt = require("bcrypt");

// helper: แปลงเป็น POINT (longitude latitude)
function pointWkt(lon, lat) {
  const _l = parseFloat(lon);
  const _a = parseFloat(lat);
  if (Number.isFinite(_l) && Number.isFinite(_a)) return `POINT(${_l} ${_a})`;
  return null;
}

// ===================== USERS =====================

// REGISTER User
router.post("/register", async (req, res) => {
  try {
    const { phoneNumber, password, name, userImage, address, gpsLocation, userType } = req.body;

    if (!phoneNumber || !password || !name || !userType) {
      return res.status(400).json({ message: "กรอกข้อมูลไม่ครบ" });
    }

    const password_hash = await bcrypt.hash(password, 10);

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
    if (!match) return res.status(401).json({ message: "รหัสผ่านไม่ถูกต้อง" });

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

// ===================== DELIVERIES =====================

// CREATE delivery
// CREATE delivery (auto lookup pickup/dropoff from Users table)
router.post("/deliveries/create", async (req, res) => {
  try {
    const {
      sender_id,               // id ของผู้ส่ง
      receiver_phone_number,   // เบอร์โทรผู้รับ
      product_image,           // รูปสินค้า
      items                    // array หรือ string JSON
    } = req.body;

    if (!sender_id || !receiver_phone_number) {
      return res.status(400).json({ message: "ต้องระบุ sender_id และ receiver_phone_number" });
    }

    // 🔍 ดึงข้อมูล Sender
    const [senderRows] = await db.execute(`SELECT address, ST_X(gps_location) AS lon, ST_Y(gps_location) AS lat FROM Users WHERE user_id = ?`, [sender_id]);
    if (senderRows.length === 0) {
      return res.status(404).json({ message: "ไม่พบข้อมูลผู้ส่ง (sender)" });
    }
    const sender = senderRows[0];

    // 🔍 ดึงข้อมูล Receiver
    const [receiverRows] = await db.execute(`SELECT address, ST_X(gps_location) AS lon, ST_Y(gps_location) AS lat FROM Users WHERE phone_number = ?`, [receiver_phone_number]);
    if (receiverRows.length === 0) {
      return res.status(404).json({ message: "ไม่พบข้อมูลผู้รับ (receiver)" });
    }
    const receiver = receiverRows[0];

    // 🧭 สร้างข้อมูล pickup/dropoff จาก Users
    const pickup_address = receiver.address || null;
    const pickup_gps = (receiver.lon && receiver.lat) ? `POINT(${receiver.lon} ${receiver.lat})` : null;

    const dropoff_address = sender.address || null;
    const dropoff_gps = (sender.lon && sender.lat) ? `POINT(${sender.lon} ${sender.lat})` : null;

    // 📨 INSERT Deliveries
    const sql = `
      INSERT INTO Deliveries 
      (sender_id, receiver_phone_number, delivery_status, product_image, 
       pickup_address, pickup_gps, dropoff_address, dropoff_gps, rider_id)
      VALUES (?, ?, 'รอไรเดอร์มารับสินค้า', ?, ?, 
              ${pickup_gps ? "ST_GeomFromText(?)" : "NULL"}, 
              ?, ${dropoff_gps ? "ST_GeomFromText(?)" : "NULL"}, NULL)
    `;

    const params = [
      sender_id,
      receiver_phone_number,
      product_image || null,
      pickup_address,
    ];
    if (pickup_gps) params.push(pickup_gps);
    params.push(dropoff_address);
    if (dropoff_gps) params.push(dropoff_gps);

    const [result] = await db.execute(sql, params);
    const deliveryId = result.insertId;

    // 📦 ถ้ามีหลายชิ้น (items)
    let itemsArr = items;
    if (items && typeof items === "string") {
      try {
        itemsArr = JSON.parse(items);
      } catch (e) {
        itemsArr = null;
      }
    }

    if (Array.isArray(itemsArr) && itemsArr.length > 0) {
      const insertItemsSql = `INSERT INTO Multi_Item_Orders (delivery_id, item_description, item_image) VALUES `;
      const values = [];
      const placeholders = itemsArr
        .map((item) => {
          values.push(deliveryId, item.item_description || null, item.item_image || null);
          return "(?, ?, ?)";
        })
        .join(", ");
      await db.execute(insertItemsSql + placeholders, values);
    }

    res.status(201).json({ message: "สร้างรายการส่งสำเร็จ", delivery_id: deliveryId });
  } catch (err) {
    console.error("create delivery err", err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
});


// GET deliveries of sender
router.get('/deliveries/sender/:sender_id', async (req, res) => {
  try {
    const { sender_id } = req.params;
    const [rows] = await db.execute(
      `SELECT d.*, 
              ST_X(d.pickup_gps) AS pickup_lon, ST_Y(d.pickup_gps) AS pickup_lat,
              ST_X(d.dropoff_gps) AS dropoff_lon, ST_Y(d.dropoff_gps) AS dropoff_lat,
              r.name AS rider_name, r.phone_number AS rider_phone
       FROM Deliveries d
       LEFT JOIN Riders r ON d.rider_id = r.rider_id
       WHERE d.sender_id = ?
       ORDER BY d.created_at DESC`,
      [sender_id]
    );

    for (let d of rows) {
      const [items] = await db.execute(`SELECT * FROM Multi_Item_Orders WHERE delivery_id = ?`, [d.delivery_id]);
      const [images] = await db.execute(`SELECT * FROM Delivery_Images WHERE delivery_id = ? ORDER BY uploaded_at ASC`, [d.delivery_id]);
      d.items = items;
      d.images = images;
    }

    res.json(rows);
  } catch (err) {
    console.error('get deliveries sender', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// GET deliveries of receiver
router.get('/deliveries/receiver/:phone', async (req, res) => {
  try {
    const { phone } = req.params;
    const [rows] = await db.execute(
      `SELECT d.*, 
              ST_X(d.pickup_gps) AS pickup_lon, ST_Y(d.pickup_gps) AS pickup_lat,
              ST_X(d.dropoff_gps) AS dropoff_lon, ST_Y(d.dropoff_gps) AS dropoff_lat,
              r.name AS rider_name, r.phone_number AS rider_phone
       FROM Deliveries d
       LEFT JOIN Riders r ON d.rider_id = r.rider_id
       WHERE d.receiver_phone_number = ?
       ORDER BY d.created_at DESC`,
      [phone]
    );

    for (let d of rows) {
      const [items] = await db.execute(`SELECT * FROM Multi_Item_Orders WHERE delivery_id = ?`, [d.delivery_id]);
      const [images] = await db.execute(`SELECT * FROM Delivery_Images WHERE delivery_id = ? ORDER BY uploaded_at ASC`, [d.delivery_id]);
      d.items = items;
      d.images = images;
    }

    res.json(rows);
  } catch (err) {
    console.error('get deliveries receiver', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// UPDATE delivery status
router.put('/deliveries/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const { delivery_status, rider_id } = req.body;
    if (!delivery_status) return res.status(400).json({ message: 'ต้องระบุ delivery_status' });

    const params = [delivery_status];
    let sql = `UPDATE Deliveries SET delivery_status = ?`;
    if (rider_id) {
      sql += `, rider_id = ?`;
      params.push(rider_id);
    }
    sql += ` WHERE delivery_id = ?`;
    params.push(id);

    await db.execute(sql, params);
    res.json({ message: 'อัปเดตสถานะสำเร็จ' });
  } catch (err) {
    console.error('update status err', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// ADD delivery status image (เก็บชื่อไฟล์)
router.post('/deliveries/:id/upload_status_image', async (req, res) => {
  try {
    const { id } = req.params;
    const { image_name, status } = req.body;

    if (!image_name || !status) {
      return res.status(400).json({ message: 'ต้องระบุชื่อไฟล์ (image_name) และสถานะ (status)' });
    }

    await db.execute(
      `INSERT INTO Delivery_Images (delivery_id, image_url, status) VALUES (?, ?, ?)`,
      [id, image_name, status]
    );

    res.json({ message: 'บันทึกรูปสถานะสำเร็จ', image_url: image_name });
  } catch (err) {
    console.error('upload status image err', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// ===================== EXPORT =====================
module.exports = router;
