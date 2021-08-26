import User from "../models/user";
import fetch from "node-fetch";
import bcrypt from "bcrypt";

export const getJoin = (req, res) =>
    res.render("join", { pageTitle: "Join" });

export const postJoin = async (req, res) => {
    const { name, email, username, password, password2, location } = req.body;
    const { file } = req;
    const pageTitle = "Join";
    const isHeroku = process.env.NODE_ENV === "production";

    if (password !== password2) {
        return res.status(400).render("join", {
            pageTitle,
            errorMessage: "Password confirmation does not match.",
        });
    }

    const exists = await User.exists({ $or: [{ username }, { email }] });
    if (exists) {
        return res.status(400).render("join", {
            pageTitle,
            errorMessage: "This username/email is already taken."
        });
    }

    try {
        await User.create({
            name, email, username, password, location,
            avatarUrl: file ? (isHeroku ? file.location : file.path) : "",
        });
        return res.redirect("/login");
    } catch (error) {
        console.log(error);
        return res.status(400).render("join", { pageTitle: "Join", errorMessage: error._message });
    }
}

export const getLogin = (req, res) => {
    res.render("login", { pageTitle: "Login" });
};

export const postLogin = async (req, res) => {
    const { username, password } = req.body;
    const user = await User.findOne({ username, socialOnly: false });
    const pageTitle = "Login";
    if (!user) {
        return res.status(400).render("login", {
            pageTitle,
            errorMessage: "An account with this username dose not exists."
        })
    }
    const ok = await bcrypt.compare(password, user.password);
    if (!ok) {
        return res.status(400).render("login", {
            pageTitle,
            errorMessage: "Wrong Password."
        })
    }
    req.session.loggedIn = true;
    req.session.user = user;
    return res.redirect("/");
};

export const startGithubLogin = (req, res) => {
    const baseUrl = "https://github.com/login/oauth/authorize";
    const config = {
        client_id: process.env.GH_CLIENT,
        allow_signup: false,
        scope: "read:user user:email",
    }
    const params = new URLSearchParams(config).toString();
    const finalUrl = `${baseUrl}?${params}`;
    res.redirect(finalUrl);
}

export const finishGithubLogin = async (req, res) => {
    const baseUrl = "https://github.com/login/oauth/access_token";
    const config = {
        client_id: process.env.GH_CLIENT,
        client_secret: process.env.GH_SECRET,
        code: req.query.code,
    }
    const params = new URLSearchParams(config).toString();
    const finalUrl = `${baseUrl}?${params}`;

    const tokenRequest = await (
        await fetch(finalUrl, {
            method: "POST",
            headers: {
                Accept: "application/json",
            },
        })
    ).json();
    if ("access_token" in tokenRequest) {
        const { access_token } = tokenRequest;
        const apiUrl = "https://api.github.com";
        const userData = await (
            await fetch(`${apiUrl}/user`, {
                headers: {
                    Authorization: `token ${access_token}`
                }
            })
        ).json();
        const emailData = await (
            await fetch(`${apiUrl}/user/emails`, {
                headers: {
                    Authorization: `token ${access_token}`
                }
            })
        ).json();

        const emailObj = emailData.find(
            email => email.primary === true && email.verified === true
        );
        if (!emailObj) {
            // set notification
            return res.redirect("/login");
        }

        let user = await User.findOne({ email: emailObj.email });
        if (!user) {
            user = await User.create({
                avatarUrl: userData.avatar_url,
                name: userData.name,
                username: userData.login,
                email: emailObj.email,
                password: "",
                socialOnly: true,
                location: userData.location,
            });
        }
        req.session.loggedIn = true;
        req.session.user = user;
        return res.redirect("/");
    } else {
        return res.redirect("/login");
    }
}

export const logout = (req, res) => {
    // req.session.destroy();
    req.session.loggedIn = false;
    req.session.user = null;

    req.flash("info", "Bye Bye");
    res.redirect("/");
};


export const getEdit = (req, res) => {
    return res.render("edit-profile", { pageTitle: "Edit Profile" });
};


export const postEdit = async (req, res) => {
    const {
        session: {
            user: { _id, avatarUrl }
        },
        body: { name, email, username, location },
        file,
    } = req;
    const userId = await User.findById({ _id });
    const findUsername = await User.exists({ username });
    const findEmail = await User.exists({ email });

    if (userId.username != username) {
        if (findUsername) {
            return res.status(400).render("edit-profile", {
                pageTitle: "Edit Profile",
                errorMessage: "This username is already taken."
            });
        }
    }
    if (userId.email != email) {
        if (findEmail) {
            return res.status(400).render("edit-profile", {
                pageTitle: "Edit Profile",
                errorMessage: "This email is already taken."
            });
        }
    }

    const isHeroku = process.env.NODE_ENV === "production";

    const updatedUser = await User.findByIdAndUpdate(_id, {
        avatarUrl: file ? (isHeroku ? file.location : file.path) : avatarUrl,
        name,
        email,
        username,
        location
    }, { new: true });
    req.session.user = updatedUser;
    return res.redirect(`/users/${userId._id}`);
};

export const getChangePassword = (req, res) => {
    if (req.session.user.socialOnly === true) {
        req.flash("error", "비밀번호를 수정할 수 없습니다.");
        return res.redirect("/");
    }
    return res.render("users/change-password", {
        pageTitle: "Change Password"
    })
}

export const postChangePassword = async (req, res) => {
    // send notification
    const {
        session: {
            user: { _id },
        },
        body: {
            oldPassword,
            newPassword,
            newPasswordConfirmation
        }
    } = req;

    const user = await User.findById({ _id });
    const ok = await bcrypt.compare(oldPassword, user.password);
    if (!ok) {
        return res.status(400).render("users/change-password", {
            pageTitle: "Change Password",
            errorMessage: "The current password is incorrect"
        });
    }

    if (newPassword !== newPasswordConfirmation) {
        return res.status(400).render("users/change-password", {
            pageTitle: "Change Password",
            errorMessage: "The password does not match the confirmation"
        });
    }

    user.password = newPassword;
    await user.save();
    req.flash("info", "비밀번호가 변경 되었습니다.");
    return res.redirect("/users/logout");
}


export const see = async (req, res) => {
    const { id } = req.params;
    const user = await User.findById(id).populate({
        path: "videos",
        populate: {
            path: "owner",
            model: "User",
        },
    });
    if (!user) {
        return res.status(404).render("404", { pageTitle: "User not found" });
    }
    return res.render("users/profile", { pageTitle: `${user.name}의 Profile`, user });
};


