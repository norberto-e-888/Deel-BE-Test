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
 * FIX ME!
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

module.exports = app;
