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

  const transaction = await sequelize.transaction();

  try {
    const lockedJob = await Job.findOne({
      include: {
        model: Contract,
        as: "Contract",
      },
      where: {
        id: req.params.id,
      },
      lock: true,
      transaction,
    });

    if (!lockedJob || lockedJob.Contract.ClientId !== req.profile.id) {
      await transaction.rollback();
      return res.status(404).send("Job not found"); // purposely sending a 404 instead of a 403 to "hide" the existence of this job
    }

    if (lockedJob.paid) {
      await transaction.rollback();
      return res.status(400).send("Job is already paid");
    }

    const originAccount = await Profile.findOne({
      where: {
        id: lockedJob.Contract.ClientId,
      },
      lock: true,
      transaction,
    });

    if (lockedJob.price > originAccount.get("balance")) {
      await transaction.rollback();
      return res.status(400).send("Insufficient funds");
    }

    await Profile.decrement("balance", {
      by: lockedJob.price,
      where: {
        id: lockedJob.Contract.ClientId,
      },
      transaction,
    });

    await Profile.increment("balance", {
      by: lockedJob.price,
      where: {
        id: lockedJob.Contract.ContractorId,
      },
      transaction,
    });

    const paymentDate = new Date();
    await Job.update(
      { paid: true, paymentDate },
      { where: { id: lockedJob.id }, transaction }
    );

    await transaction.commit();
    res.json({
      ...lockedJob.get(),
      paid: true,
      paymentDate,
    });
  } catch (error) {
    await transaction.rollback();
    res.send("Server error");
  }
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
      "id",
      [
        s.literal(
          "`Contract->Client`.`firstName` || ' ' || `Contract->Client`.`lastName`"
        ), // sqlite has no concat fn, would use s.fn('concat') otherwise
        "fullName",
      ],
      [s.fn("SUM", s.col("price")), "paid"],
    ],
    order: [[s.fn("SUM", s.col("price")), "DESC"]],
    limit: req.query.limit ? parseInt(req.query.limit) : undefined,
  });

  return res.json(
    clientPayAggregations.map((aggregation) => ({
      id: aggregation.dataValues.id,
      fullName: aggregation.dataValues.fullName,
      paid: aggregation.dataValues.paid,
    }))
  );
});

module.exports = app;
