require("dotenv").config();
const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const db = require("./db");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const authMiddleware = require("./authMiddleware");

// multer configuration for file uploads can be added here if needed

const multer = require("multer");
const path = require("path");

// Storage config
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/items");
  },
  filename: (req, file, cb) => {
    const uniqueName =
      Date.now() +
      "-" +
      Math.round(Math.random() * 1e9) +
      path.extname(file.originalname);
    cb(null, uniqueName);
  },
});

const upload = multer({ storage });

const app = express();
const PORT = 3000;

app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

app.use("/uploads", express.static("uploads"));

app.get("/", (req, res) => {
  res.send("LIMS backend running");
});

// fetch items with optional filters

app.get("/items", (req, res) => {
  const { type, category, location, q } = req.query;

  let sql = `
    SELECT 
      items.id,
      items.item_type,
      items.title,
      items.description,
      items.image_url,
      items.created_at,
      categories.name AS category,
      locations.name AS location,
      item_statuses.status_name AS status,
      users.full_name AS reported_by
    FROM items
    JOIN categories ON items.category_id = categories.id
    JOIN locations ON items.location_id = locations.id
    JOIN item_statuses ON items.item_status_id = item_statuses.id
    JOIN users ON items.user_id = users.id
    WHERE item_statuses.status_name != 'deleted'
   `;

  const params = [];

  // lost / found filter
  if (type) {
    sql += " AND items.item_type = ?";
    params.push(type);
  }

  // category filter
  if (category) {
    sql += " AND items.category_id = ?";
    params.push(category);
  }

  // location filter
  if (location) {
    sql += " AND items.location_id = ?";
    params.push(location);
  }

  // keyword search
  if (q) {
    sql += " AND (items.title LIKE ? OR items.description LIKE ?)";
    params.push(`%${q}%, %${q}% `);
  }

  sql += " ORDER BY items.created_at DESC";

  db.query(sql, params, (err, results) => {
    if (err) {
      return res.status(500).json({ message: "Failed to fetch items" });
    }

    res.json(results);
  });
});

// fetch pending items for admin review

app.get("/admin/items/pending", authMiddleware, (req, res) => {
  if (req.user.role !== "admin") {
    return res.status(403).json({ message: "Admin access only" });
  }
  const sql = ` SELECT 
      items.id,
      items.item_type,
      items.title,
      items.description,
      items.created_at,
      categories.name AS category,
      locations.name AS location,
      users.full_name AS reported_by
    FROM items
    JOIN categories ON items.category_id = categories.id
    JOIN locations ON items.location_id = locations.id
    JOIN users ON items.user_id = users.id
    JOIN item_statuses ON items.item_status_id = item_statuses.id
    WHERE item_statuses.status_name = 'pending'
    ORDER BY items.created_at ASC
  `;

  db.query(sql, (err, results) => {
    if (err) {
      return res.status(500).json({ message: "Failed to fetch pending items" });
    }

    res.json(results);
  });
});

// sign up page

app.post("/signup", (req, res) => {
  const { fullName, email, phone, password } = req.body;

  if (!fullName || !email || !password) {
    return res.status(400).json({ message: "Missing required fields" });
  }

  // Hash password
  bcrypt.hash(password, 10, (err, hashedPassword) => {
    if (err) {
      return res.status(500).json({ message: "Password hashing failed" });
    }

    const sql = `
      INSERT INTO users (full_name, email, phone, password)
      VALUES (?, ?, ?, ?)
    `;

    db.query(sql, [fullName, email, phone, hashedPassword], (err) => {
      if (err) {
        if (err.code === "ER_DUP_ENTRY") {
          return res.status(409).json({ message: "Email already exists" });
        }
        return res.status(500).json({ message: "Database error" });
      }

      res.status(201).json({ message: "User registered successfully" });
    });
  });
});

// login page

app.post("/login", (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: "Email and password are required" });
  }

  const sql = "SELECT * FROM users WHERE email = ?";

  db.query(sql, [email], (err, results) => {
    if (err) {
      return res.status(500).json({ message: "Database error" });
    }

    if (results.length === 0) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    const user = results[0];

    bcrypt.compare(password, user.password, (err, isMatch) => {
      if (err) {
        return res.status(500).json({ message: "Password comparison failed" });
      }

      if (!isMatch) {
        return res.status(401).json({ message: "Invalid email or password" });
      }

      // 🔐 CREATE JWT
      const token = jwt.sign(
        {
          userId: user.id,
          role: user.role,
        },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRES_IN },
      );

      // Login success
      res.json({
        message: "Login successful",
        token,
        user: {
          id: user.id,
          full_name: user.full_name,
          email: user.email,
          role: user.role,
        },
      });
    });
  });
});

// upload page
// To be implemented: file upload handling using multer or similar middleware

app.post("/items", authMiddleware, upload.single("image"), (req, res) => {
  const user_id = req.user.userId; // 🔐 FROM TOKEN

  const {
    item_type,
    title,
    description,
    category_id,
    location_id,
    lost_date,
    found_date,
  } = req.body;

  if (!item_type || !title || !description || !category_id || !location_id) {
    return res.status(400).json({ message: "Missing required fields" });
  }

  const imageUrl = req.file ? `/uploads/items/${req.file.filename}` : null;

  const sql =
    "INSERT INTO items (user_id, item_type, title, description, category_id, location_id, lost_date, found_date, image_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)";

  db.query(
    sql,
    [
      user_id,
      item_type,
      title,
      description,
      category_id,
      location_id,
      lost_date || null,
      found_date || null,
      imageUrl,
    ],
    (err, result) => {
      if (err) {
        return res
          .status(500)
          .json({ message: "Failed to upload item", error: err });
      }

      res.status(201).json({
        message: "Item uploaded successfully",
        item_id: result.insertId,
      });
    },
  );
});

// EDIT ITEM (owner or admin only)
app.put("/items/:id", authMiddleware, (req, res) => {
  const itemId = req.params.id;
  const userId = req.user.userId;
  const role = req.user.role;

  const {
    title,
    description,
    category_id,
    location_id,
    lost_date,
    found_date,
  } = req.body;

  // Step 1: fetch the item
  db.query(
    "SELECT user_id FROM items WHERE id = ?",
    [itemId],
    (err, results) => {
      if (err) {
        return res.status(500).json({ message: "Database error" });
      }

      if (results.length === 0) {
        return res.status(404).json({ message: "Item not found" });
      }

      const itemOwnerId = results[0].user_id;

      // Step 2: permission check
      if (itemOwnerId !== userId && role !== "admin") {
        return res.status(403).json({
          message: "You are not allowed to edit this item",
        });
      }

      // Step 3: update item
      const updateSql = ` UPDATE items
        SET
          title = ?,
          description = ?,
          category_id = ?,
          location_id = ?,
          lost_date = ?,
          found_date = ?
        WHERE id = ?
      `;

      db.query(
        updateSql,
        [
          title,
          description,
          category_id,
          location_id,
          lost_date || null,
          found_date || null,
          itemId,
        ],
        (err) => {
          if (err) {
            return res.status(500).json({ message: "Failed to update item" });
          }

          res.json({ message: "Item updated successfully" });
        },
      );
    },
  );
});

// DELETE ITEM (owner or admin only)

app.delete("/items/:id", authMiddleware, (req, res) => {
  const itemId = req.params.id;
  const userId = req.user.userId;
  const role = req.user.role;

  // Step 1: fetch item owner
  db.query(
    "SELECT user_id FROM items WHERE id = ?",
    [itemId],
    (err, results) => {
      if (err) {
        return res.status(500).json({ message: "Database error" });
      }

      if (results.length === 0) {
        return res.status(404).json({ message: "Item not found" });
      }

      const itemOwnerId = results[0].user_id;

      // Step 2: permission check
      if (itemOwnerId !== userId && role !== "admin") {
        return res.status(403).json({
          message: "You are not allowed to delete this item",
        });
      }

      // Step 3: delete item
      db.query("DELETE FROM items WHERE id = ?", [itemId], (err) => {
        if (err) {
          return res.status(500).json({ message: "Failed to delete item" });
        }

        // ✅ LOG ADMIN ACTION (only if admin)
        if (role === "admin") {
          db.query(
            "INSERT INTO admin_actions (admin_id, action_type, target_id, target_type, details) VALUES (?, 'delete_item', ?, 'item', ?)",
            [userId, itemId, `Admin deleted item ID ${itemId}`],
          );

          // ✅ ITEM HISTORY
          db.query(
            "INSERT INTO item_history (item_id, user_id, action, old_value, new_value) VALUES (?, ?, 'deleted', NULL, 'item removed')",
            [itemId, userId],
          );
        }

        res.json({ message: "Item deleted successfully" });
      });
    },
  );
});

// admin item verification

app.post("/admin/items/verify", authMiddleware, (req, res) => {
  const { item_id, action } = req.body;

  const admin_id = req.user.userId;
  const role = req.user.role;

  if (role !== "admin") {
    return res.status(403).json({ message: "Admin access only" });
  }

  if (!item_id || !action) {
    return res.status(400).json({ message: "Missing required fields" });
  }

  if (!["verified", "rejected"].includes(action)) {
    return res.status(400).json({ message: "Invalid action" });
  }

  db.query(
    "SELECT id FROM item_statuses WHERE status_name = ?",
    [action],
    (err, statusResult) => {
      if (err || statusResult.length === 0) {
        return res.status(500).json({ message: "Invalid status" });
      }

      const statusId = statusResult[0].id;

      const updateSql =
        "UPDATE items SET item_status_id = ?, is_verified = ?, verified_by = ?, verified_at = NOW() WHERE id = ?";

      db.query(
        updateSql,
        [statusId, action === "verified" ? 1 : 0, admin_id, item_id],
        (err) => {
          if (err) {
            return res.status(500).json({ message: "Failed to update item" });
          }

          db.query(
            "INSERT INTO admin_actions (admin_id, action_type, target_id, target_type) VALUES (?, ?, ?, 'item')",
            [admin_id, action, item_id],
          );

          res.json({ message: `Item ${action} successfully` });
        },
      );
    },
  );
});

// report item

app.post("/items/:itemId/report", authMiddleware, (req, res) => {
  const itemId = req.params.itemId;
  const reportedBy = req.user.userId; // from JWT
  const { reason, description } = req.body;

  if (!description) {
    return res.status(400).json({ message: "Description is required" });
  }

  // Check item exists
  db.query("SELECT id FROM items WHERE id = ?", [itemId], (err, items) => {
    if (err) {
      return res.status(500).json({ message: "Database error" });
    }

    if (items.length === 0) {
      return res.status(404).json({ message: "Item not found" });
    }

    // Insert report
    const sql =
      "INSERT INTO reported_items (item_id, reported_by, reason, description) VALUES (?, ?, ?, ?)";

    db.query(sql, [itemId, reportedBy, reason || null, description], (err) => {
      if (err) {
        if (err.code === "ER_DUP_ENTRY") {
          return res
            .status(409)
            .json({ message: "You already reported this item" });
        }

        return res.status(500).json({ message: "Failed to report item" });
      }

      res.status(201).json({
        message: "Item reported successfully",
      });
    });
  });
});

// admin view reported items

app.get("/admin/reported-items", authMiddleware, (req, res) => {
  // Only admins allowed
  if (req.user.role !== "admin") {
    return res.status(403).json({ message: "Admin access only" });
  }

  const sql = `SELECT
      ri.id AS report_id,
      ri.reason,
      ri.description,
      ri.status,
      ri.created_at AS reported_at,
      ri.reviewed_at,
      ri.admin_note,

      i.id AS item_id,
      i.title,
      i.item_type,

      reporter.full_name AS reported_by,
      owner.full_name AS item_owner,
      reviewer.full_name AS reviewed_by

    FROM reported_items ri
    JOIN items i ON ri.item_id = i.id
    JOIN users reporter ON ri.reported_by = reporter.id
    JOIN users owner ON i.user_id = owner.id
    LEFT JOIN users reviewer ON ri.reviewed_by = reviewer.id

    ORDER BY ri.created_at DESC
  `;

  db.query(sql, (err, results) => {
    if (err) {
      return res.status(500).json({
        message: "Failed to fetch reported items",
        error: err,
      });
    }

    res.json(results);
  });
});

// admin take action on reported item

app.post("/admin/reports/action", authMiddleware, (req, res) => {
  if (req.user.role !== "admin") {
    return res.status(403).json({ message: "Admin access only" });
  }

  const adminId = req.user.userId;
  const { report_id, action, admin_note } = req.body;

  if (!report_id || !["ignore", "delete"].includes(action)) {
    return res.status(400).json({ message: "Invalid request" });
  }

  // 1. Get report info
  const getReportSql = `SELECT item_id
    FROM reported_items
    WHERE id = ? AND status = 'pending'
  `;

  db.query(getReportSql, [report_id], (err, reportResult) => {
    if (err || reportResult.length === 0) {
      return res
        .status(404)
        .json({ message: "Report not found or already handled" });
    }

    const itemId = reportResult[0].item_id;

    // 2. If action = delete → mark item as deleted
    if (action === "delete") {
      const deleteItemSql = `UPDATE items
        SET item_status_id = (
          SELECT id FROM item_statuses WHERE status_name = 'deleted'
        )
        WHERE id = ?
      `;

      db.query(deleteItemSql, [itemId], (err) => {
        if (err) {
          return res.status(500).json({ message: "Failed to delete item" });
        }

        logAdminActionAndResolveReport();
      });
    } else {
      // ignore
      logAdminActionAndResolveReport();
    }

    // 3. Update report + log admin action
    function logAdminActionAndResolveReport() {
      const updateReportSql = `UPDATE reported_items
        SET
          status = ?,
          reviewed_by = ?,
          reviewed_at = NOW(),
          admin_note = ?
        WHERE id = ?
      `;

      const reportStatus = action === "delete" ? "resolved" : "dismissed";

      db.query(
        updateReportSql,
        [reportStatus, adminId, admin_note || null, report_id],
        (err) => {
          if (err) {
            return res.status(500).json({ message: "Failed to update report" });
          }

          // Log admin action
          db.query(
            `INSERT INTO admin_actions (admin_id, action_type, target_id, target_type, details)
            VALUES (?, ?, ?, 'item', ?)`,
            [
              adminId,
              action === "delete" ? "delete_item" : "ignore_report",
              itemId,
              admin_note || null,
            ],
          );

          res.json({
            message:
              action === "delete"
                ? "Item deleted and report resolved"
                : "Report dismissed successfully",
          });
        },
      );
    }
  });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
