const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const db = require("./db");
const bcrypt = require("bcrypt");

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
  const { type, category, location } = req.query;

  let sql = ` SELECT 
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
    WHERE 1=1
   `;

  const params = [];

  // Filter by lost / found
  if (type) {
    sql += " AND items.item_type = ?";
    params.push(type);
  }

  // Filter by category
  if (category) {
    sql += " AND items.category_id = ?";
    params.push(category);
  }

  // Filter by location
  if (location) {
    sql += " AND items.location_id = ?";
    params.push(location);
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

app.get("/admin/items/pending", (req, res) => {
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

      // Login success
      res.json({
        message: "Login successful",
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

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

// upload page
// To be implemented: file upload handling using multer or similar middleware

app.post("/items", upload.single("image"), (req, res) => {
  const {
    user_id,
    item_type,
    title,
    description,
    category_id,
    location_id,
    lost_date,
    found_date,
  } = req.body;

  if (
    !user_id ||
    !item_type ||
    !title ||
    !description ||
    !category_id ||
    !location_id
  ) {
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

// admin item verification

app.post("/admin/items/verify", (req, res) => {
  const { admin_id, item_id, action } = req.body;

  if (!admin_id || !item_id || !action) {
    return res.status(400).json({ message: "Missing required fields" });
  }

  if (!["verified", "rejected"].includes(action)) {
    return res.status(400).json({ message: "Invalid action" });
  }

  // Check admin role
  db.query("SELECT role FROM users WHERE id = ?", [admin_id], (err, result) => {
    if (err || result.length === 0) {
      return res.status(403).json({ message: "Admin not found" });
    }

    if (result[0].role !== "admin") {
      return res.status(403).json({ message: "Access denied" });
    }

    // Get status id
    db.query(
      "SELECT id FROM item_statuses WHERE status_name = ?",
      [action],
      (err, statusResult) => {
        if (err || statusResult.length === 0) {
          return res.status(500).json({ message: "Invalid status" });
        }

        const statusId = statusResult[0].id;

        const updateSql = `UPDATE items
            SET 
              item_status_id = ?,
              is_verified = ?,
              verified_by = ?,
              verified_at = NOW()
            WHERE id = ?`;

        db.query(
          updateSql,
          [statusId, action === "verified" ? 1 : 0, admin_id, item_id],
          (err) => {
            if (err) {
              return res.status(500).json({ message: "Failed to update item" });
            }

            // Log admin action
            db.query(
              "INSERT INTO admin_actions (admin_id, action_type, target_id, target_type) VALUES (?, ?, ?, 'item')",
              [admin_id, action, item_id],
              (err) => {
                if (err) {
                  console.error("Failed to log admin action:", err);
                }
              },
            );

            res.json({ message: `Item ${action} successfully` });
          },
        );
      },
    );
  });
});
