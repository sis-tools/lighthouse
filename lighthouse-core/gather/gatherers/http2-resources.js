/**
 * @license
 * Copyright 2016 Google Inc. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

'use strict';

const url = require('url');
const Gatherer = require('./gatherer');

class HTTP2Resources extends Gatherer {

  afterPass(options, tracingData) {
    const finalHost = url.parse(options.url).host;
    const initialHost = url.parse(options.initialUrl).host;

    // Find requests made to resources on this origin which are http/1.1 or older.
    const oldProtocols = tracingData.networkRecords.reduce((prev, record) => {
      const requestHost = url.parse(record.url).host;
      const sameOrigin = requestHost === finalHost ||
                         requestHost === initialHost;
      if (record.protocol.match(/HTTP\/[01][\.\d]?/i) && sameOrigin) {
        // prev.push({url: record.url, protocol: record.protocol});
        prev.push(record);
      }
      return prev;
    }, []);

    this.artifact = oldProtocols;
  }
}

module.exports = HTTP2Resources;
