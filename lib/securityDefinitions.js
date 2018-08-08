const AWS = require('aws-sdk');
const P = require('bluebird');

exports.addAurhorizersPermission = async (cfg) => {
  const authorizers = extractAuthorizers(cfg);

  if (!authorizers) {
    return;
  }

  await removePermission(authorizers);
  await addPermission(authorizers);
};

function extractAuthorizers(cfg) {
  const {securityDefinitions} = cfg.swagger;
  const {region, stage, restApiId} = cfg;

  return securityDefinitions && Object
    .values(securityDefinitions)
    .map((definition) => {
      const {authorizerUri} = definition['x-amazon-apigateway-authorizer'];

      if (!authorizerUri) {
        throw new Error('"authorizerUri" is not defined');
      }

      const [, accountId, lambdaName] = authorizerUri
        .match(/aws:lambda:\{\{region\}\}:(.+):function:(.+):/);

      return prepareApiCall({
        region,
        stage,
        restApiId,
        accountId,
        lambdaName,
      });
    });
}

function prepareApiCall({region, stage, restApiId, accountId, lambdaName}) {
  return {
    action: 'lambda:InvokeFunction',
    functionName: `arn:aws:lambda:${region}:${accountId}:function:${lambdaName}:${stage}`,
    principal: 'apigateway.amazonaws.com',
    sourceArn: `arn:aws:execute-api:${region}:${accountId}:${restApiId}/*`,
    statementId: `${restApiId}${lambdaName}${stage}`,
  };
}

function removePermission(authorizers) {
  const lambda = new AWS.Lambda({apiVersion: '2015-03-31'});
  const chain = authorizers.map(({functionName, statementId}) => lambda
    .removePermission({FunctionName: functionName, StatementId: statementId})
    .promise()
    .catch((err) => {
      if (err.name === 'ResourceNotFoundException') {
        return;
      }

      throw err;
    }));

  return P.all(chain);
}

function addPermission(authorizers) {
  const lambda = new AWS.Lambda({apiVersion: '2015-03-31'});
  const chain = authorizers.map((authorizer) => lambda
    .addPermission({
      Action: authorizer.action,
      FunctionName: authorizer.functionName,
      Principal: authorizer.principal,
      SourceArn: authorizer.sourceArn,
      StatementId: authorizer.statementId,
    })
    .promise());

  return P.all(chain);
}
