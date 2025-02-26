require("dotenv").config(); // Load environment variables from .env
const express = require("express");
const admin = require("firebase-admin");
const twilio = require("twilio");

// Load the Firebase Service Account Key
const serviceAccount = JSON.parse(
  Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_KEY, "base64").toString("utf-8")
);

// Initialize Firebase Admin SDK
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

// Initialize Twilio Client
const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

const db = admin.firestore();
const app = express();
const port = process.env.PORT || 3000;

// Track the latest notification timestamp
let latestNotificationTimestamp = null;

// Validate phone number
const isValidPhoneNumber = (phoneNumber) => {
  return phoneNumber && phoneNumber.startsWith("+") && phoneNumber.length >= 10;
};

// Format Philippine phone numbers
const formatPhoneNumber = (phoneNumber) => {
  if (phoneNumber.startsWith("0")) {
    return `+63${phoneNumber.slice(1)}`; // Convert "0998150XXXX" to "+63998150XXXX"
  }
  return phoneNumber; // Assume it's already in E.164 format
};

// Listen for Firestore changes
db.collection("notifications")
  .orderBy("datetime", "asc") // Order by datetime (ascending)
  .onSnapshot((snapshot) => {
    snapshot.docChanges().forEach((change) => {
      if (change.type === "added") {
        const notificationData = change.doc.data();
        const { trashLevel, bin, datetime, notificationId } = notificationData;

        // Skip old notifications
        if (latestNotificationTimestamp && datetime <= latestNotificationTimestamp) {
          return;
        }

        // Update the latest timestamp
        latestNotificationTimestamp = datetime;

        // Fetch user's contact number from Firestore
        db.collection("users").get().then((usersSnapshot) => {
          usersSnapshot.forEach((userDoc) => {
            const userData = userDoc.data();
            let { contactNumber, firstName } = userData;

            // Format the phone number
            contactNumber = formatPhoneNumber(contactNumber);

            // Send SMS if trash level is critical and phone number is valid
            if (trashLevel >= 90 && isValidPhoneNumber(contactNumber)) {
              const message = `🚨 Alert: Hi ${firstName}, Bin ${bin} is ${trashLevel}% full! Notification ID: ${notificationId}. Please take action.`;

              twilioClient.messages
                .create({
                  body: message,
                  from: process.env.TWILIO_PHONE_NUMBER, // Use environment variable
                  to: contactNumber,   // User's contact number from Firestore
                })
                .then((message) => console.log(`SMS sent: ${message.sid}`))
                .catch((error) => console.error("Error sending SMS:", error));
            } else {
              console.error(`Invalid phone number: ${contactNumber}`);
            }
          });
        });
      }
    });
  });

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});