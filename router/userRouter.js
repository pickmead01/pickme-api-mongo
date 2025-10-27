const express = require("express");
const User = require("../model/user");
const bcrypt = require("bcrypt");
const logChanges = require("../logChanges.js");
const verifyUser = require("../verifyUser");
const saltRounds = 10; // 8, 10, 12, 14

const userRouter = new express.Router();

async function getUser(req, res, next) {
  const { username } = req.params;
  let user;
  try {
    user = await User.findOne({ username });
    // return res.json(user)
    if (user === undefined) {
      return res.status(404).json({ message: "can't find user!" });
    }
  } catch (err) {
    return res.status(500).send({ message: err.message });
  }
  res.user = user;
  next();
}

userRouter.get("/user", verifyUser, async (req, res) => {
  try {
    const userList = await User.find().limit(10).sort({ username: 1 });
    // console.log(`router get user: ${JSON.stringify(res.json(user))}`)
    res.status(200).send(userList);
  } catch (err) {
    res.status(500).send({ message: err.message });
  }
});

userRouter.post("/login", async (req, res) => {
  const { username, password } = req.body;
  let user;
  const regexEmail = /\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+/;
  const validateEmail = (email) => regexEmail.test(email);

  try {
    // 檢查 `username` 是否符合電子郵件格式
    const isEmail = validateEmail(username);

    // 根據 `username` 是否為電子郵件查找用戶
    if (isEmail) {
      user = await User.findOne({ email: username }).exec();
    } else {
      user = await User.findOne({ username }).exec();
    }

    if (!user) {
      return res.status(404).json({ message: "can't find user or email!" });
    }

    let result = await bcrypt.compare(password, user.password);
    if (result) {
      req.session.isVerified = true;
      req.session.user = user.username;
      req.session.role = user.role;
      req.session.status = user.status;

      // 強制立即保存 session
      await new Promise((resolve, reject) => {
        req.session.save(err => (err ? reject(err) : resolve()));
      });

      await logChanges(
        req.method,
        req.path,
        user,
        User,
        "user",
        req.session.user
      );

      return res.status(200).json({ message: "login successful" });
    } else {
      return res
        .status(404)
        .json({ message: "login failed: password not correct" });
    }
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

//logout
userRouter.post("/logout", async (req, res) => {
  try {
    req.session.destroy();
    return res.status(201).json({ message: "You had been logout" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// register
userRouter.post("/register", async (req, res) => {
  const { email, username, password } = req.body;
  const regexLowercase = /^(?=.*[a-z])/;
  const regexUppercase = /^(?=.*[A-Z])/;
  const regexMinLength = /[0-9a-zA-Z]{6,}/;

  let checkLowercase = regexLowercase.test(password);
  let checkUppercase = regexUppercase.test(password);
  let checkMinLength = regexMinLength.test(password);

  try {
    let checkUser = await User.findOne({ username: username });
    let checkEmail = await User.findOne({ email: email });
    let errors = [];
    if (!checkLowercase) {
      errors.push("Password must contain at least one lowercase letter.");
    }
    if (!checkUppercase) {
      errors.push("Password must contain at least one uppercase letter.");
    }
    if (!checkMinLength) {
      errors.push("Password must be at least 6 characters.");
    }
    if (checkUser) {
      errors.push("username has been used");
    }
    if (checkEmail) {
      errors.push("email has been used");
    }
    if (errors.length > 0) {
      return res.status(400).json({ messages: errors });
    }
    const postHash = await bcrypt.hash(password, saltRounds);
    const newUser = new User({ email, username, password: postHash });
    const saveUser = await newUser.save();
    const registerUserSuccess = Object.assign({}, saveUser["_doc"], {
      errorMessage: "register successfully",
    });
    await logChanges(
      req.method,
      req.path,
      saveUser,
      User,
      "user",
      saveUser.username
    );

    res.status(201).json(registerUserSuccess);
  } catch (err) {
    res.status(500).send({ message: err.message });
  }
});

// delete user account
userRouter.delete("/user/:username", verifyUser, getUser, async (req, res) => {
  try {
    await logChanges(
      req.method,
      req.path,
      res.user,
      User,
      "user",
      req.session.user,
      true
    );
    await res.user.remove();
    res.json({ message: "Delete user successful!" });
  } catch (err) {
    res.status(500).send({ message: err.message });
  }
});

// modify user account
userRouter.patch("/user/:username", verifyUser, getUser, async (req, res) => {
  const { email, password, status, role, remarks } = req.body;
  try {
    if (email !== undefined) res.user.email = email;
    if (password !== undefined)
      res.user.password = await bcrypt.hash(password, saltRounds);
    if (status !== undefined) res.user.status = status;
    if (role !== undefined) res.user.role = role;
    if (remarks !== undefined) res.user.remarks = remarks;
    const originalUser = await User.findOne(res.user._id);
    await logChanges(
      req.method,
      req.path,
      res.user,
      User,
      "user",
      req.session.user,
      originalUser
    );
    await res.user.save();
    res.status(201).json({ message: "User information updated successfully" });
  } catch (err) {
    res.status(500).send({ message: err.message });
  }
});

module.exports = userRouter;
