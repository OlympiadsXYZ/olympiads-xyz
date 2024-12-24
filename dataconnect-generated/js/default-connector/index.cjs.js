const { getDataConnect, validateArgs } = require('firebase/data-connect');

const connectorConfig = {
  connector: 'default',
  service: 'olympiads-xyz',
  location: 'europe-west6'
};
exports.connectorConfig = connectorConfig;

