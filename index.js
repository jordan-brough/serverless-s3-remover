'use strict';

const chalk = require('chalk');
const prompt = require('prompt');
const messagePrefix = 'S3 Remover: ';

class Remover {
  constructor (serverless, options) {
    this.serverless = serverless;
    this.options = options;
    this.provider =  this.serverless.getProvider('aws');

    let config = this.serverless.service.custom.remover;
    this.config = Object.assign({}, {
      prompt: false,
      buckets: []
    }, config);

    this.commands = {
      s3remove: {
        usage: 'Remove all files in S3 buckets',
        lifecycleEvents: [
          'remove'
        ],
        options: {
          verbose: {
            usage: 'Increase verbosity',
            shortcut: 'v'
          }
        }
      },
      test: {
        usage: "test",
        lifecycleEvents: [
          "test"
        ]
      }
    };

    this.hooks = {
      "test:test": () => Promise.resolve().then(this.test.bind(this)),
      'before:remove:remove': () => Promise.resolve().then(this.remove.bind(this)),
      's3remove:remove': () => Promise.resolve().then(this.remove.bind(this))
    };
  }

  log(message) {
    if (this.options.verbose) {
      this.serverless.cli.log(message);
    }
  }

  test() {
    const self = this;
    return new Promise((resolve) => {
      const sls = JSON.stringify(self.serverless, null, "  ");
      const opt = JSON.stringify(self.options, null, "  ");
      this.serverless.cli.log(sls);
      this.serverless.cli.log(opt);
    });
  }

  remove() {
    const self = this;
    const buckets = self.config.buckets;

    const getAllKeys = (bucket) => {
      const get = (src = {}) => {
        const data = src.data;
        const keys = src.keys || [];
        const param = {
          Bucket: bucket
        };
        if (data) {
          param.ContinuationToken = data.NextContinuationToken;
        }
        return self.provider.request('S3', 'listObjectsV2', param, self.options.stage, self.options.region).then((result) => {
          return new Promise((resolve) => {
            resolve({data: result, keys: keys.concat(result.Contents.map((item) => {return item.Key;}))});
          });
        });
      };
      const list = (src = {}) => {
        return get(src).then((result) => {
          if (result.data.IsTruncated) {
            return list(result);
          } else {
            const keys = result.keys;
            const objects = keys.map((item) => {return {Key: item};});
            const param = {
              Bucket: bucket,
              Delete: {
                Objects: objects
              }
            };
            return new Promise((resolve) => { resolve(param); });
          }
        });
      };
      return list();
    };
    const getAllKeysV2 = (bucket) => {
      const getType = (src) => {
        return Object.prototype.toString.call(src);
      };
      const listType = {
        string: getType(""),
        object: getType({})
      };
      const getStackName = () => {
        let stage = self.serverless.service.provider.stage;
        if (self.options.stage != null) {
          stage = self.options.stage;
        }
        return `${self.serverless.service.service}-${stage}`;
      };
      const getBucketName = (data) => {
        return new Promise((resolve, reject) => {
          if (getType(data.rawBucket) === listType.string){
            data.bucket = data.rawBucket;
            resolve(data);
            return;
          }
          const ref = data.rawBucket.Ref;
          const params = {
            StackName: getStackName(),
          }
          self.provider.request()
        });
      };
    };
    const executeRemove = (param) => {
      return self.provider.request('S3', 'deleteObjects', param, self.options.stage, self.options.region);
    };

    return new Promise((resolve) => {
      if (!self.config.prompt) {
        let promisses = [];
        for (const b of buckets) {
          promisses.push(getAllKeys(b).then(executeRemove).then(() => {
            const message = `Success: ${b} is empty.`;
            self.log(message);
            self.serverless.cli.consoleLog(`${messagePrefix}${chalk.yellow(message)}`);
          }).catch(() => {
            const message = `Faild: ${b} may not be empty.`;
            self.log(message);
            self.serverless.cli.consoleLog(`${messagePrefix}${chalk.yellow(message)}`);
          }));
        }
        return Promise.all(promisses).then(resolve);
      }
      prompt.message = messagePrefix;
      prompt.delimiter = '';
      prompt.start();
      const schema = {properties: {}};
      buckets.forEach((b) => {
        schema.properties[b] = {
          message: `Make ${b} empty. Are you sure? [yes/no]:`,
          validator: /(yes|no)/,
          required: true,
          warning: 'Must respond yes or no'
        };
      });
      prompt.get(schema, (err, result) => {
        let promisses = [];
        for (const b of buckets) {
          if (result[b].match(/^y/)) {
            promisses.push(getAllKeys(b).then(executeRemove).then(() => {
              const message = `Success: ${b} is empty.`;
              self.log(message);
              self.serverless.cli.consoleLog(`${messagePrefix}${chalk.yellow(message)}`);
            }).catch(() => {
              const message = `Faild: ${b} may not be empty.`;
              self.log(message);
              self.serverless.cli.consoleLog(`${messagePrefix}${chalk.yellow(message)}`);
            }));
          } else {
            promisses.push(Promise.resolve().then(() => {
              const message = `Remove cancelled: ${b}`;
              self.log(message);
              self.serverless.cli.consoleLog(`${messagePrefix}${chalk.yellow(message)}`);
            }));
          }
        }
        Promise.all(promisses).then(resolve);
      });
    });
  }
  removeV2() {
    const self = this;
    const buckets = self.config.buckets;

    const getType = (src) => {
      return Object.prototype.toString.call(src);
    };
    const listType = {
      string: getType(""),
      object: getType({})
    };

    const getStackName = () => {
      let stage = self.serverless.service.provider.stage;
      if (self.options.stage != null) {
        stage = self.options.stage;
      }
      return `${self.serverless.service.service}-${stage}`;
    }
    const getBucketName = (data) => {
      return new Promise((resolve, reject) => {
        const rawBucket = data.rawBucket;
        if (getType(rawBucket) === listType.string) {
          data.bucket = rawBucket;
          resolve(data);
          return;
        }
        const ref = rawBucket.Ref;
        if (getType(ref) !== listType.string) {
          reject(new Error("illegal data"));
          return;
        }
        self.provider.request("CloudFormation", 'describeStackResource', {
          LogicalResourceId: ref,
          StackName: getStackName()
        }, param, self.options.stage, self.options.region).then((res) => {
          data.bucket = res.StackResourceDetail.PhysicalResourceId;
          resolve(data);
        }).catch((err) => {
          reject(err);
        });
      });
    };
    const getKeys = (param) => {
      const parseKey = (item) => {
        return item.Key;
      };
      const get = (data) => {
        return new Promise((resolve, reject) => {
          self.provider.request("S3", "listObjectsV2", data, self.options.stage, self.options.region).then((res) => {
            const contents = res.Contents;
            const keys = contents.map(parseKey);
            const token = res.NextContinuationToken;
            if (token == null) {
              resolve(keys);
            } else {
              data.ContinuationToken = token;
              Promise.resolve(data).then(get).then((res2) => {
                const result = [].concat(keys, res2);
                resolve(result);
              }).catch((err) => {
                reject(err);
              });
            }
          }).catch((err) => {
            reject(err);
          });
        });
      };
      Promise.resolve({
        Bucket: param.bucket
      })
    };
  }
}

module.exports = Remover;
