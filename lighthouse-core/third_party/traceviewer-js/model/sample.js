"use strict";
/**
Copyright (c) 2013 The Chromium Authors. All rights reserved.
Use of this source code is governed by a BSD-style license that can be
found in the LICENSE file.
**/

require("../base/unit.js");
require("./timed_event.js");

'use strict';

/**
 * @fileoverview Provides the Sample class.
 */
global.tr.exportTo('tr.model', function () {
  /**
   * A Sample represents a sample taken at an instant in time, plus its stack
   * frame and parameters associated with that sample.
   *
   * @constructor
   */
  function Sample(cpu, thread, title, start, leafStackFrame, opt_weight, opt_args) {
    tr.model.TimedEvent.call(this, start);

    this.title = title;
    this.cpu = cpu;
    this.thread = thread;
    this.leafStackFrame = leafStackFrame;
    this.weight = opt_weight;
    this.args = opt_args || {};
  }

  Sample.prototype = {
    __proto__: tr.model.TimedEvent.prototype,

    get colorId() {
      return this.leafStackFrame.colorId;
    },

    get stackTrace() {
      return this.leafStackFrame.stackTrace;
    },

    getUserFriendlyStackTrace: function () {
      return this.leafStackFrame.getUserFriendlyStackTrace();
    },

    get userFriendlyName() {
      return 'Sample at ' + tr.b.Unit.byName.timeStampInMs.format(this.start);
    }
  };

  tr.model.EventRegistry.register(Sample, {
    name: 'sample',
    pluralName: 'samples'
  });

  return {
    Sample: Sample
  };
});