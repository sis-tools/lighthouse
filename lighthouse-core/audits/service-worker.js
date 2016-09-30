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
const Audit = require('./audit');

/**
 * @param {string} targetURL
 * @return {string}
 */
function getOrigin(targetURL) {
  const parsedURL = url.parse(targetURL);
  return `${parsedURL.protocol}//${parsedURL.hostname}` +
      (parsedURL.port ? `:${parsedURL.port}` : '');
}

/**
 * @param {!Array<!ServiceWorkerVersion>} versions
 * @param {string} url
 * @return {(!ServiceWorkerVersion|undefined)}
 */
function getActivatedServiceWorker(versions, url) {
  const origin = getOrigin(url);
  return versions.find(v => v.status === 'activated' && getOrigin(v.scriptURL) === origin);
}

class ServiceWorker extends Audit {
  /**
   * @return {!AuditMeta}
   */
  static get meta() {
    return {
      category: 'Offline',
      name: 'service-worker',
      description: 'Has a registered Service Worker',
      requiredArtifacts: ['URL', 'ServiceWorker']
    };
  }

  /**
   * @param {!Artifacts} artifacts
   * @return {!AuditResult}
   */
  static audit(artifacts) {
    if (!artifacts.ServiceWorker.versions) {
      // Error in ServiceWorker gatherer.
      return ServiceWorker.generateAuditResult({
        rawValue: false,
        debugString: artifacts.ServiceWorker.debugString
      });
    }

    // Find active service worker for this URL. Match against
    // artifacts.URL.finalUrl so audit accounts for any redirects.
    const version = getActivatedServiceWorker(
        artifacts.ServiceWorker.versions, artifacts.URL.finalUrl);
    const debugString = version ? undefined : 'No active service worker found for this origin.';

    return ServiceWorker.generateAuditResult({
      rawValue: !!version,
      debugString: debugString
    });
  }
}

module.exports = ServiceWorker;
