const express = require("express");
const app = express();
const cors = require("cors");
require("dotenv").config();
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const stripe = require("stripe")(process.env.STRIPE_SECRET);
const crypto = require("crypto");

const port = process.env.PORT || 3000;

const admin = require("firebase-admin");
// const serviceAccount = require("./style-decor-auth-firebase-adminsdk.json");

const decoded = Buffer.from(process.env.FB_SERVICE_KEY, 'base64').toString('utf8')
const serviceAccount = JSON.parse(decoded);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

function generateTrackingId() {
  const prefix = "STLD";
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, ""); // YYYYMMDD
  const random = crypto.randomBytes(3).toString("hex").toUpperCase(); // 6-char random hex

  return `${prefix}-${date}-${random}`;
}

//middleware
app.use(express.json());
app.use(cors());

const verifyFBToken = async (req, res, next) => {
  const token = req.headers.authorization;

  if (!token) {
    return res.status(401).send({ message: "unauthorized access" });
  }

  try {
    const idToken = token.split(" ")[1];
    const decoded = await admin.auth().verifyIdToken(idToken);
    console.log("decoded in the token", decoded);
    req.decoded_email = decoded.email;
    next();
  } catch (err) {
    return res.status(401).send({ message: "unauthorized access" });
  }
};

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster0.upddivc.mongodb.net/?appName=Cluster0`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();

    const db = client.db("styleDecorDB");
    const usersCollection = db.collection("users");
    const servicesCollection = db.collection("services");
    const bookingsCollection = db.collection("bookings");
    const paymentCollection = db.collection("payments");
    const decoratorsCollection = db.collection("decorators");
    const consultationsCollection = db.collection("consultations");

    // middle admin before allowing admin activity
    // must be used after verifyFBToken middleware
    

    // users related apis
    app.get("/users/:email/role", async (req, res) => {
      const email = req.params.email;
      const query = { email };
      const user = await usersCollection.findOne(query);
      res.send({ role: user?.role || "user" });
    });

    app.get("/users", verifyFBToken, async (req, res) => {
      const searchText = req.query.searchText;
      const query = {};

      if (searchText) {
        query.$or = [
          { displayName: { $regex: searchText, $options: "i" } },
          { email: { $regex: searchText, $options: "i" } },
        ];
      }

      const cursor = usersCollection
        .find(query)
        .sort({ createdAt: -1 })
        .limit(5);
      const result = await cursor.toArray();
      res.send(result);
    });

    app.get("/users", verifyFBToken, async (req, res) => {
      const result = await usersCollection.find().toArray();
      res.send(result);
    });

    app.post("/users", async (req, res) => {
      const user = req.body;
      user.role = "user";
      user.createdAt = new Date();
      const email = user.email;
      const userExists = await usersCollection.findOne({ email });

      if (userExists) {
        return res.send({ message: "user exists" });
      }

      const result = await usersCollection.insertOne(user);
      res.send(result);
    });

    app.patch(
      "/users/:id/role",
      verifyFBToken,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;
        const roleInfo = req.body;
        const query = { _id: new ObjectId(id) };
        const updatedDoc = {
          $set: {
            role: roleInfo.role,
          },
        };
        const result = await usersCollection.updateOne(query, updatedDoc);
        res.send(result);
      }
    );

    app.delete("/users/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };

      const result = await usersCollection.deleteOne(query);
      res.send(result);
    });

    //services related apis
    app.post("/services", async (req, res) => {
      const newService = req.body;
      newService.createdAt = new Date();
      const existingService = await servicesCollection.findOne({
        serviceTitle: newService.serviceTitle,
      });
      if (existingService) {
        return res.send("Service already exists. Do not insert again.");
      }
      const result = await servicesCollection.insertOne(newService);
      res.send(result);
    });

    app.get("/services", async (req, res) => {
      const result = await servicesCollection.find({}).toArray();
      res.send(result);
    });

    app.get("/services/:id", async (req, res) => {
      const { id } = req.params;
      try {
        const service = await servicesCollection.findOne({
          _id: new ObjectId(id),
        });
        if (!service) {
          return res.status(404).send({ message: "Service not found" });
        }
        res.send(service);
      } catch (error) {
        res.status(500).send({ message: "Server error", error });
      }
    });

    app.delete("/services/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };    
      const result = await servicesCollection.deleteOne(query); 
      res.send(result);
    });

    //bookings related apis
    app.post("/bookings", async (req, res) => {
      const newBooking = req.body;
      newBooking.createdAt = new Date();
      newBooking.paymentStatus = "unpaid";
      newBooking.workStatus = "pending";
      const result = await bookingsCollection.insertOne(newBooking);
      res.send(result);
    });

    app.get("/bookings", async (req, res) => {
      const query = {};
      const { email } = req.query;
      if (email) {
        query.userEmail = email;
      }

      const options = { sort: { createdAt: -1 } };

      const cursor = bookingsCollection.find(query, options);
      const result = await cursor.toArray();
      res.send(result);
    });

    app.get("/bookings", async (req, res) => {
      const result = await bookingsCollection.find({}).toArray();
      res.send(result);
    });

    app.get("/bookings/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await bookingsCollection.findOne(query);
      res.send(result);
    });

    app.delete("/bookings/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };

      const result = await bookingsCollection.deleteOne(query);
      res.send(result);
    });

    app.patch("/bookings/:id/assign-decorator", async (req, res) => {
      const { decoratorId, decoratorName, decoratorEmail } = req.body;
      const { id } = req.params;

      if (!decoratorId) {
        return res.status(400).send({ error: "decoratorId is required" });
      }

      try {
        const query = { _id: new ObjectId(id) };

        const updatedDoc = {
          $set: {
            workStatus: "decorator_assigned",
            decoratorId,
            decoratorName: decoratorName || null,
            decoratorEmail: decoratorEmail || null,
          },
        };

        const result = await bookingsCollection.updateOne(query, updatedDoc);

        if (result.matchedCount === 0) {
          return res.status(404).send({ error: "Booking not found" });
        }

        const decoratorQuery = { _id: new ObjectId(decoratorId) };
        const decoratorUpdatedDoc = {
          $set: {
            workStatus: "booked",
          },
        };

        const decoratorResult = await decoratorsCollection.updateOne(
          decoratorQuery,
          decoratorUpdatedDoc
        );

        if (decoratorResult.matchedCount === 0) {
          console.warn(`Decorator with ID ${decoratorId} not found`);
        }

        res.status(200).send({
          success: true,
          bookingUpdated: result.modifiedCount > 0,
          decoratorUpdated: decoratorResult.modifiedCount > 0,
          message: "Decorator assigned successfully",
        });
      } catch (error) {
        console.error("Error assigning decorator:", error);
        res.status(500).send({ error: "Internal server error" });
      }
    });

    //consultation
    app.post("/consultations", async (req, res) => {
      const newConsultation = req.body;
      newConsultation.createdAt = new Date();
      const result = await consultationsCollection.insertOne(newConsultation);
      res.send(result);
    });

    app.get("/consultations", async (req, res) => {
      const query = {};
      const { email } = req.query;
      if (email) {
        query.userEmail = email;
      }

      const options = { sort: { createdAt: -1 } };

      const cursor = consultationsCollection.find(query, options);
      const result = await cursor.toArray();
      res.send(result);
    });

    app.get("/consultations/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await consultationsCollection.findOne(query);
      res.send(result);
    });

    app.delete("/consultations/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };

      const result = await consultationsCollection.deleteOne(query);
      res.send(result);
    });

    // payment related apis
    app.post("/payment-checkout-session", async (req, res) => {
      const paymentInfo = req.body;
      const amount = parseInt(paymentInfo.cost) * 100;
      const session = await stripe.checkout.sessions.create({
        line_items: [
          {
            price_data: {
              currency: "usd",
              unit_amount: amount,
              product_data: {
                name: `Please pay for: ${paymentInfo.serviceName}`,
              },
            },
            quantity: 1,
          },
        ],
        customer_email: paymentInfo.customerEmail,
        mode: "payment",
        metadata: {
          bookingId: paymentInfo.bookingId,
          serviceId: paymentInfo.serviceId,
          serviceName: paymentInfo.serviceName,
        },
        success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cancelled`,
      });

      res.send({ url: session.url });
    });

    app.patch("/payment-success", async (req, res) => {
      const sessionId = req.query.session_id;
      const session = await stripe.checkout.sessions.retrieve(sessionId);

      // console.log("retrieved session", session);
      const transactionId = session.payment_intent;
      const query = { transactionId: transactionId };

      const paymentExist = await paymentCollection.findOne(query);
      console.log(paymentExist);
      if (paymentExist) {
        return res.send({
          message: "already exists",
          transactionId,
          trackingId: paymentExist.trackingId,
        });
      }

      const trackingId = generateTrackingId();

      if (session.payment_status === "paid") {
        const id = session.metadata.bookingId;
        const query = { _id: new ObjectId(id) };
        const update = {
          $set: {
            paymentStatus: "paid",
            BookingStatus: "confirmed",
            trackingId: trackingId,
          },
        };

        const result = await bookingsCollection.updateOne(query, update);

        const payment = {
          amount: session.amount_total / 100,
          currency: session.currency,
          customerEmail: session.customer_email,
          serviceId: session.metadata.serviceId,
          bookingId: session.metadata.bookingId,
          serviceName: session.metadata.serviceName,
          transactionId: session.payment_intent,
          paymentStatus: session.payment_status,
          paidAt: new Date(),
          trackingId: trackingId,
        };

        if (session.payment_status === "paid") {
          const resultPayment = await paymentCollection.insertOne(payment);

          res.send({
            success: true,
            modifyBooking: result,
            trackingId: trackingId,
            transactionId: session.payment_intent,
            paymentInfo: resultPayment,
          });
        }
      }

      res.send({ success: false });
    });

    // payment related apis
    app.get("/payments", verifyFBToken, async (req, res) => {
      const email = req.query.email;
      const query = {};

      console.log("headers", req.headers);

      if (email) {
        query.customerEmail = email;

        // check email address
        if (email !== req.decoded_email) {
          return res.status(403).send({ message: "forbidden access" });
        }
      }
      const cursor = paymentCollection.find(query).sort({ paidAt: -1 });
      const result = await cursor.toArray();
      res.send(result);
    });

    // decorators related apis
    app.get("/decorators", async (req, res) => {
      const query = {};
      if (req.query.status) {
        query.status = req.query.status;
      }
      const cursor = decoratorsCollection.find(query);
      const result = await cursor.toArray();
      res.send(result);
    });

    app.post("/decorators", async (req, res) => {
      const decorator = req.body;
      decorator.status = "pending";
      decorator.createdAt = new Date();

      const result = await decoratorsCollection.insertOne(decorator);
      res.send(result);
    });

    app.patch(
      "/decorators/:id",
      verifyFBToken,
      verifyAdmin,
      async (req, res) => {
        const status = req.body.status;
        const id = req.params.id;
        const query = { _id: new ObjectId(id) };
        const updatedDoc = {
          $set: {
            status: status,
            workStatus: "available",
          },
        };

        const result = await decoratorsCollection.updateOne(query, updatedDoc);

        if (status === "approved") {
          const email = req.body.email;
          const userQuery = { email };
          const updateUser = {
            $set: {
              role: "decorator",
            },
          };
          const userResult = await usersCollection.updateOne(
            userQuery,
            updateUser
          );
        }

        res.send(result);
      }
    );

    app.delete("/decorators/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await decoratorsCollection.deleteOne(query);
      res.send(result);
    });

    // Send a ping to confirm a successful connection
    // await client.db("admin").command({ ping: 1 });
    // console.log(
    //   "Pinged your deployment. You successfully connected to MongoDB!"
    // );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("styleDecor is shifting shifting");
});

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
