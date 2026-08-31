const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

const uploadDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
  },
});

const ALLOWED = ['.png', '.jpg', '.jpeg', '.webp', '.pdf'];

const upload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED.includes(ext)) {
      return cb(new Error('نوع الملف غير مسموح.'));
    }
    cb(null, true);
  },
});

// Generic authenticated file upload (images for menu items, products,
// prescriptions, amanat item photos). Returns a relative path the client
// then references when creating/editing the related record.
router.post('/', authenticate, (req, res) => {
  upload.single('file')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || 'فشل رفع الملف.' });
    if (!req.file) return res.status(400).json({ error: 'لم يتم إرفاق ملف.' });
    res.status(201).json({ path: `/uploads/${req.file.filename}` });
  });
});

module.exports = router;
