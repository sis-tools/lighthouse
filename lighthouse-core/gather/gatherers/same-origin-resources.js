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

class SameOriginResources extends Gatherer {

  afterPass(options, tracingData) {
    const finalHost = url.parse(options.url).host;
    const initialHost = url.parse(options.initialUrl).host;

    // Find requests that are on the same origin as the page.
    const results = tracingData.networkRecords.reduce((prev, record) => {
      const requestHost = url.parse(record.url).host;
      const sameOrigin = requestHost === finalHost ||
                         requestHost === initialHost;
      if (sameOrigin) {
        prev.push(record);
      }
      return prev;
    }, []);

    this.artifact = results;
  }
}

module.exports = SameOriginResources;
