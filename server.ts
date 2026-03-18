/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import path from "path";
import { createServer as createViteServer } from "vite";
import multer from "multer";
import fs from "fs";

// Ensure uploads directory exists
const uploadsDir = path.join(process.cwd(), "public", "uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, file.fieldname + "-" + uniqueSuffix + path.extname(file.originalname));
  },
});

const upload = multer({ storage });

async function startServer() {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
    },
  });

  const PORT = 3000;

  app.use(express.json());
  app.use("/uploads", express.static(uploadsDir));

  // Hardcoded users as requested
  const users = [
    { id: "sohamsantra196", name: "Soham Santra", password: "IdontloveADlab", bio: "Hala Madrid!", avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=Soham" },
    { id: "alishakhan214", name: "Alisha Khan", password: "IdontloveADlab", bio: "Loves coding", avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=Alisha" },
    { id: "augnikganguly079", name: "Augnik Ganguly", password: "IdontloveADlab", bio: "Tech enthusiast", avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=Augnik" },
    { id: "soumajitdutta272", name: "Soumajit Dutta", password: "IdontloveADlab", bio: "Music is life", avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=Soumajit" },
    { id: "srijanaha273", name: "Srija Naha", password: "IdontloveADlab", bio: "Art and design", avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=Srija" },
  ];

  // In-memory store for user profiles (since we don't have a DB yet, we'll use this)
  const userProfiles = new Map(users.map(u => [u.id, { ...u }]));

  app.post("/api/login", (req, res) => {
    const { userId, password } = req.body;
    const user = userProfiles.get(userId);
    if (user && user.password === password) {
      const { password: _, ...userWithoutPassword } = user;
      res.json({ success: true, user: userWithoutPassword });
    } else {
      res.status(401).json({ success: false, message: "Invalid credentials" });
    }
  });

  app.post("/api/upload", upload.single("file"), (req: any, res) => {
    if (!req.file) return res.status(400).send("No file uploaded.");
    const fileUrl = `/uploads/${req.file.filename}`;
    res.json({ url: fileUrl, type: req.file.mimetype });
  });

  app.post("/api/profile/update", (req, res) => {
    const { userId, bio, avatar } = req.body;
    const profile = userProfiles.get(userId);
    if (profile) {
      if (bio !== undefined) profile.bio = bio;
      if (avatar !== undefined) profile.avatar = avatar;
      userProfiles.set(userId, profile);
      res.json({ success: true, profile });
    } else {
      res.status(404).json({ success: false, message: "User not found" });
    }
  });

  app.get("/api/users", (req, res) => {
    const allUsers = Array.from(userProfiles.values()).map(({ password: _, ...u }) => u);
    res.json(allUsers);
  });

  // Socket.io logic
  const connectedUsers = new Map(); // userId -> socketId

  io.on("connection", (socket) => {
    console.log("A user connected:", socket.id);

    socket.on("register", (userId) => {
      connectedUsers.set(userId, socket.id);
      io.emit("user_status", { userId, status: "online" });
    });

    socket.on("send_message", (data) => {
      // data: { from, to, content, type, timestamp, mediaUrl }
      if (data.to === "group") {
        socket.broadcast.emit("receive_message", data);
      } else {
        const targetSocketId = connectedUsers.get(data.to);
        if (targetSocketId) {
          io.to(targetSocketId).emit("receive_message", data);
        }
      }
    });

    socket.on("typing", (data) => {
      // data: { from, to, isTyping }
      if (data.to === "group") {
        socket.broadcast.emit("user_typing", data);
      } else {
        const targetSocketId = connectedUsers.get(data.to);
        if (targetSocketId) {
          io.to(targetSocketId).emit("user_typing", data);
        }
      }
    });

    socket.on("disconnect", () => {
      for (const [userId, socketId] of connectedUsers.entries()) {
        if (socketId === socket.id) {
          connectedUsers.delete(userId);
          io.emit("user_status", { userId, status: "offline" });
          break;
        }
      }
      console.log("User disconnected");
    });
  });

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
