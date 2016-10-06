"use strict";
/**
Copyright (c) 2013 The Chromium Authors. All rights reserved.
Use of this source code is governed by a BSD-style license that can be
found in the LICENSE file.
**/

require("../base/unit.js");
require("./event.js");

'use strict';

global.tr.exportTo('tr.model', function () {
  /**
   * A snapshot of an object instance, at a given moment in time.
   *
   * Initialization of snapshots and instances is three phased:
   *
   * 1. Instances and snapshots are constructed. This happens during event
   *    importing. Little should be done here, because the object's data
   *    are still being used by the importer to reconstruct object references.
   *
   * 2. Instances and snapshtos are preinitialized. This happens after implicit
   *    objects have been found, but before any references have been found and
   *    switched to direct references. Thus, every snapshot stands on its own.
   *    This is a good time to do global field renaming and type conversion,
   *    e.g. recognizing domain-specific types and converting from C++ naming
   *    convention to JS.
   *
   * 3. Instances and snapshtos are initialized. At this point, {id_ref:
   *    '0x1000'} fields have been converted to snapshot references. This is a
   *    good time to generic initialization steps and argument verification.
   *
   * @constructor
   */
  function ObjectSnapshot(objectInstance, ts, args) {
    tr.model.Event.call(this);
    this.objectInstance = objectInstance;
    this.ts = ts;
    this.args = args;
  }

  ObjectSnapshot.prototype = {
    __proto__: tr.model.Event.prototype,

    /**
     * See ObjectSnapshot constructor notes on object initialization.
     */
    preInitialize: function () {},

    /**
     * See ObjectSnapshot constructor notes on object initialization.
     */
    initialize: function () {},

    /**
     * Called when an object reference is resolved as this ObjectSnapshot.
     * @param {Object} item The event (async slice, slice or object) containing
     *     the resolved reference.
     * @param {Object} object The object directly containing the reference.
     * @param {String} field The field name of the reference in |object|.
     */
    referencedAt: function (item, object, field) {},

    addBoundsToRange: function (range) {
      range.addValue(this.ts);
    },

    get userFriendlyName() {
      return 'Snapshot of ' + this.objectInstance.typeName + ' ' + this.objectInstance.id + ' @ ' + tr.b.Unit.byName.timeStampInMs.format(this.ts);
    }
  };

  tr.model.EventRegistry.register(ObjectSnapshot, {
    name: 'objectSnapshot',
    pluralName: 'objectSnapshots'
  });

  return {
    ObjectSnapshot: ObjectSnapshot
  };
});