const app = require("../src/app");
const request = require("supertest");
const { faker } = require("@faker-js/faker");
const { sequelize } = require("../src/model");

describe("Deel Test API", () => {
  let profileFactory;
  let contractFactory;
  let jobFactory;

  beforeAll(async () => {
    profileFactory = ProfileFactory(sequelize.model("Profile"));
    contractFactory = ContractFactory(sequelize.model("Contract"));
    jobFactory = JobFactory(sequelize.model("Job"));
  });

  beforeEach(async () => {
    const Profile = sequelize.model("Profile");
    const Contract = sequelize.model("Contract");
    const Job = sequelize.model("Job");

    await Promise.all([
      Profile.truncate(),
      Contract.truncate(),
      Job.truncate(),
    ]);
  });

  describe("GET /contracts", () => {
    it("Rejects unauthenticated requests", async () => {
      await request(app).get("/contracts").expect(401);
    });

    it("Returns the contracts belogning to a user as either client or contractor", async () => {
      await profileFactory.add({ id: 10, type: "client" });
      await profileFactory.add({ id: 11, type: "contractor" });
      await contractFactory.add({ id: 20, ClientId: 10, ContractorId: 11 });

      const clientResponse = await request(app)
        .get("/contracts")
        .set("profile_id", "10")
        .expect(200);

      expect(clientResponse.body.length).toBe(1);
      expect(clientResponse.body[0].ClientId).toBe(10);
      expect(clientResponse.body[0].id).toBe(20);

      const contractorResponse = await request(app)
        .get("/contracts")
        .set("profile_id", "11")
        .expect(200);

      expect(contractorResponse.body.length).toBe(1);
      expect(contractorResponse.body[0].ContractorId).toBe(11);
      expect(contractorResponse.body[0].id).toBe(20);
    });
  });

  describe("POST /jobs/:id/pay", () => {
    it("Allows an unpaid job to be paid by the client if they have enough balance", async () => {
      const Profile = sequelize.model("Profile");
      const Job = sequelize.model("Job");
      const jobPrice = 200;
      const clientOriginalBalance = 500;
      const clientExpectedBalance = clientOriginalBalance - jobPrice;
      const contractorOriginalBalance = 75;
      const contractorExpectedBalance = contractorOriginalBalance + jobPrice;

      expect(clientOriginalBalance >= jobPrice).toBe(true);

      await profileFactory.add({
        id: 10,
        type: "client",
        balance: clientOriginalBalance,
      });

      await profileFactory.add({
        id: 11,
        type: "contractor",
        balance: contractorOriginalBalance,
      });

      await contractFactory.add({ id: 20, ClientId: 10, ContractorId: 11 });
      await jobFactory.add({ id: 30, ContractId: 20, price: jobPrice });

      await request(app)
        .post("/jobs/30/pay")
        .set("profile_id", "11")
        .expect(404);

      await request(app)
        .post("/jobs/30/pay")
        .set("profile_id", "10")
        .expect(200);

      const job = await Job.findOne({
        where: {
          id: 30,
        },
      });

      const client = await Profile.findOne({
        where: {
          id: 10,
        },
      });

      const contractor = await Profile.findOne({
        where: {
          id: 11,
        },
      });

      expect(job.get("paid")).toBe(true);
      expect(job.get("paymentDate")).toBeDefined();
      expect(client.get("balance")).toBe(clientExpectedBalance);
      expect(contractor.get("balance")).toBe(contractorExpectedBalance);
    });
  });
});

function ProfileFactory(profileModel) {
  return {
    add: async ({
      id,
      type,
      firstName = faker.name.firstName(),
      lastName = faker.name.lastName(),
      profession = faker.commerce.department(),
      balance = 0,
    }) =>
      profileModel.create({
        id,
        type,
        firstName,
        lastName,
        profession,
        balance,
      }),
  };
}

function ContractFactory(contractModel) {
  return {
    add: async ({
      id,
      ClientId,
      ContractorId,
      status = "in_progress",
      terms = faker.lorem.sentences(2),
    }) => {
      contractModel.create({
        id,
        ClientId,
        ContractorId,
        terms,
        status,
      });
    },
  };
}

function JobFactory(jobModel) {
  return {
    add: async ({
      id,
      ContractId,
      description = faker.lorem.sentence(1),
      price = 100,
      paid = false,
      paymentDate,
    }) =>
      jobModel.create({
        id,
        ContractId,
        description,
        price,
        paid,
        paymentDate,
      }),
  };
}
