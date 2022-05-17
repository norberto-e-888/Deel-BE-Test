const express = require("express");
const bodyParser = require("body-parser");
const { sequelize } = require("./model");
const { getProfile } = require("./middleware/getProfile");
const s = require("sequelize");
const app = express();
app.use(bodyParser.json());
app.set("sequelize", sequelize);
app.set("models", sequelize.models);

/**
 * @returns contract by id
 */
app.get("/contracts/:id", getProfile, async (req, res) => {
  const { Contract } = req.app.get("models");
  const { id } = req.params;
  const contract = await Contract.findOne({ where: { id } });

  if (!contract) return res.status(404).end();

  if (
    contract.ContractorId !== req.profile.id &&
    contract.ClientId !== req.profile.id
  )
    return res.status(403).end();

  res.json(contract);
});

app.get("/contracts", getProfile, async (req, res) => {
  const { Contract } = req.app.get("models");
  const contracts = await Contract.findAll({
    where: {
      [s.Op.or]: [
        { ContractorId: req.profile.id },
        { ClientId: req.profile.id },
      ],
      status: {
        [s.Op.ne]: "terminated",
      },
    },
  });

  res.json(contracts);
});

app.get("/jobs/unpaid", getProfile, async (req, res) => {
  const { Job, Contract } = req.app.get("models");
  const jobs = await Job.findAll({
    include: {
      model: Contract,
      as: "Contract",
      where: {
        status: "in_progress",
        [s.Op.or]: [
          { ContractorId: req.profile.id },
          { ClientId: req.profile.id },
        ],
      },
    },
    where: {
      paid: false,
    },
  });

  res.json(jobs);
});

app.post("/jobs/:id/pay", getProfile, async (req, res) => {
  const { Job, Contract, Profile } = req.app.get("models");
  const job = await Job.findOne({
    include: {
      model: Contract,
      as: "Contract",
    },
    where: {
      id: req.params.id,
    },
  });

  // ! in reality we should lock the two profiles and the job to prevent the transaction going throught in case they experience changes while we construct the transaction

  /*   const client = await Profile.findOne({
    where: {
      id: job.Contract.ClientId,
    },
  });

  const contractor = await Profile.findOne({
    where: {
      id: job.Contract.ContractorId,
    },
  });
 */
  // return res.json({ client, contractor, job, profile: req.profile }); // For debugging purposes

  if (!job || job.Contract.ClientId !== req.profile.id)
    return res.status(404).end(); // purposely sending a 404 instead of a 403 to "hide" the existence of this job

  if (job.paid) return res.status(400).send("Job is already paid");

  if (job.price > req.profile.balance)
    return res.status(400).send("Insufficient funds");

  const transaction = await sequelize.transaction();

  try {
    await Profile.decrement("balance", {
      by: job.price,
      where: {
        id: job.Contract.ClientId,
      },
      transaction,
    });

    await Profile.increment("balance", {
      by: job.price,
      where: {
        id: job.Contract.ContractorId,
      },
      transaction,
    });

    await Job.update(
      { paid: true, paymentDate: new Date() },
      { where: { id: job.id }, transaction }
    );
    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    return res.send("Server error");
  }

  res.json(job);
});

app.get("/admin/best-profession", getProfile, async (req, res) => {
  // ! req.query should be validated using a libray like Joi, omitting from brevity
  const query = {};

  if (req.query.start || req.query.end) {
    query[s.Op.and] = [];

    if (req.query.start) {
      query[s.Op.and].push({
        paymentDate: { [s.Op.gte]: new Date(req.query.start) },
      });
    }

    if (req.query.end) {
      query[s.Op.and].push({
        paymentDate: { [s.Op.lte]: new Date(req.query.end) },
      });
    }
  }

  const { Job, Contract, Profile } = req.app.get("models");
  const [highestPaidProfession] = await Job.findAll({
    where: {
      paid: true,
      ...query,
    },
    include: {
      model: Contract,
      as: "Contract",
      include: {
        model: Profile,
        as: "Contractor",
      },
    },
    group: "Contract.Contractor.profession",
    attributes: [
      [s.col("Contract.Contractor.profession"), "profession"],
      [s.fn("SUM", s.col("price")), "totalIncome"],
    ],
    order: [[s.fn("SUM", s.col("price")), "DESC"]],
    limit: 1,
  });

  if (!highestPaidProfession) {
    return res
      .status(404)
      .send(
        "No profession meets the criteria, please try broadening you search"
      );
  }

  return res.json({
    profession: highestPaidProfession.dataValues.profession,
    totalIncome: highestPaidProfession.dataValues.totalIncome,
  });
});

app.get("/admin/best-clients", getProfile, async (req, res) => {
  // ! req.query should be validated using a libray like Joi, omitting from brevity
  const query = {};

  if (req.query.start || req.query.end) {
    query[s.Op.and] = [];

    if (req.query.start) {
      query[s.Op.and].push({
        paymentDate: { [s.Op.gte]: new Date(req.query.start) },
      });
    }

    if (req.query.end) {
      query[s.Op.and].push({
        paymentDate: { [s.Op.lte]: new Date(req.query.end) },
      });
    }
  }

  const { Job, Contract, Profile } = req.app.get("models");
  const clientPayAggregations = await Job.findAll({
    where: {
      paid: true,
      ...query,
    },
    include: {
      model: Contract,
      as: "Contract",
      include: {
        model: Profile,
        as: "Client",
      },
    },
    group: "Contract.ClientId",
    attributes: [
      [s.col("Contract.Client.firstName"), "firstName"],
      [s.col("Contract.Client.lastName"), "lastName"],
      [s.fn("SUM", s.col("price")), "totalPaid"],
    ],
    order: [[s.fn("SUM", s.col("price")), "DESC"]],
    limit: req.query.limit ? parseInt(req.query.limit) : undefined,
  });

  return res.json(
    clientPayAggregations.map((aggregation) => ({
      firstName: aggregation.dataValues.firstName,
      lastName: aggregation.dataValues.lastName,
      totalPaid: aggregation.dataValues.totalPaid,
    }))
  );
});

module.exports = app;
