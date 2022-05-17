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

    await Job.update({ paid: true }, { where: { id: job.id }, transaction });
    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    return res.send("Server error");
  }

  res.json(job);
});

module.exports = app;
