import "dotenv/config";
import express from "express";

const app = express();
const PORT = process.env.PORT || 3001;

app.get("/", async (req, res) => {
  try {
    const url = `${process.env.SUPABASE_URL}/rest/v1/users?select=*`;

    const response = await fetch(url, {
      method: "GET",
      headers: {
        apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      },
    });

    const text = await response.text();

    res.status(response.status).json({
      status: response.status,
      ok: response.ok,
      body: text,
    });
  } catch (error) {
    res.status(500).json({
      error: error.message,
    });
  }
});

app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});