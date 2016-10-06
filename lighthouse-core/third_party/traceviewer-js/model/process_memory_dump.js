"use strict";
/**
Copyright (c) 2015 The Chromium Authors. All rights reserved.
Use of this source code is governed by a BSD-style license that can be
found in the LICENSE file.
**/

require("../base/unit.js");
require("./container_memory_dump.js");
require("./memory_allocator_dump.js");
require("./vm_region.js");

'use strict';

/**
 * @fileoverview Provides the ProcessMemoryDump class.
 */
global.tr.exportTo('tr.model', function () {

  // Names of MemoryAllocatorDump(s) from which tracing overhead should be
  // discounted.
  var DISCOUNTED_ALLOCATOR_NAMES = ['winheap', 'malloc'];

  // The path to where the tracing overhead dump should be added to the
  // winheap/malloc allocator dump tree.
  var TRACING_OVERHEAD_PATH = ['allocated_objects', 'tracing_overhead'];

  var SIZE_NUMERIC_NAME = tr.model.MemoryAllocatorDump.SIZE_NUMERIC_NAME;
  var RESIDENT_SIZE_NUMERIC_NAME = tr.model.MemoryAllocatorDump.RESIDENT_SIZE_NUMERIC_NAME;

  function getSizeNumericValue(dump, sizeNumericName) {
    var sizeNumeric = dump.numerics[sizeNumericName];
    if (sizeNumeric === undefined) return 0;
    return sizeNumeric.value;
  }

  /**
   * The ProcessMemoryDump represents a memory dump of a single process.
   * @constructor
   */
  function ProcessMemoryDump(globalMemoryDump, process, start) {
    tr.model.ContainerMemoryDump.call(this, start);
    this.process = process;
    this.globalMemoryDump = globalMemoryDump;

    // Process memory totals (optional object) with the following fields (also
    // optional):
    //   - residentBytes: Total resident bytes (number)
    //   - peakResidentBytes: Peak resident bytes (number)
    //   - arePeakResidentBytesResettable: Flag whether peak resident bytes are
    //     resettable (boolean)
    //   - platformSpecific: Map from OS-specific total names (string) to sizes
    //     (number)
    this.totals = undefined;

    this.vmRegions = undefined;

    // Map from allocator names to heap dumps.
    this.heapDumps = undefined;

    this.tracingOverheadOwnershipSetUp_ = false;
    this.tracingOverheadDiscountedFromVmRegions_ = false;
  }

  ProcessMemoryDump.prototype = {
    __proto__: tr.model.ContainerMemoryDump.prototype,

    get userFriendlyName() {
      return 'Process memory dump at ' + tr.b.Unit.byName.timeStampInMs.format(this.start);
    },

    get containerName() {
      return this.process.userFriendlyName;
    },

    get processMemoryDumps() {
      var dumps = {};
      dumps[this.process.pid] = this;
      return dumps;
    },

    get hasOwnVmRegions() {
      return this.vmRegions !== undefined;
    },

    setUpTracingOverheadOwnership: function (opt_model) {
      // Make sure that calling this method twice won't lead to
      // 'double-discounting'.
      if (this.tracingOverheadOwnershipSetUp_) return;
      this.tracingOverheadOwnershipSetUp_ = true;

      var tracingDump = this.getMemoryAllocatorDumpByFullName('tracing');
      if (tracingDump === undefined || tracingDump.owns !== undefined) {
        // The tracing dump either doesn't exist, or it already owns another
        // dump.
        return;
      }

      if (tracingDump.owns !== undefined) return;

      // Add an ownership link from tracing to
      // malloc/allocated_objects/tracing_overhead or
      // winheap/allocated_objects/tracing_overhead.
      var hasDiscountedFromAllocatorDumps = DISCOUNTED_ALLOCATOR_NAMES.some(function (allocatorName) {
        // First check if the allocator root exists.
        var allocatorDump = this.getMemoryAllocatorDumpByFullName(allocatorName);
        if (allocatorDump === undefined) return false; // Allocator doesn't exist, try another one.

        var nextPathIndex = 0;
        var currentDump = allocatorDump;
        var currentFullName = allocatorName;

        // Descend from the root towards tracing_overhead as long as the dumps
        // on the path exist.
        for (; nextPathIndex < TRACING_OVERHEAD_PATH.length; nextPathIndex++) {
          var childFullName = currentFullName + '/' + TRACING_OVERHEAD_PATH[nextPathIndex];
          var childDump = this.getMemoryAllocatorDumpByFullName(childFullName);
          if (childDump === undefined) break;

          currentDump = childDump;
          currentFullName = childFullName;
        }

        // Create the missing descendant dumps on the path from the root
        // towards tracing_overhead.
        for (; nextPathIndex < TRACING_OVERHEAD_PATH.length; nextPathIndex++) {
          var childFullName = currentFullName + '/' + TRACING_OVERHEAD_PATH[nextPathIndex];
          var childDump = new tr.model.MemoryAllocatorDump(currentDump.containerMemoryDump, childFullName);
          childDump.parent = currentDump;
          currentDump.children.push(childDump);

          currentFullName = childFullName;
          currentDump = childDump;
        }

        // Add the ownership link.
        var ownershipLink = new tr.model.MemoryAllocatorDumpLink(tracingDump, currentDump);
        tracingDump.owns = ownershipLink;
        currentDump.ownedBy.push(ownershipLink);
        return true;
      }, this);

      // Force rebuilding the memory allocator dump index (if we've just added
      // a new memory allocator dump).
      if (hasDiscountedFromAllocatorDumps) this.forceRebuildingMemoryAllocatorDumpByFullNameIndex();
    },

    discountTracingOverheadFromVmRegions: function (opt_model) {
      // Make sure that calling this method twice won't lead to
      // 'double-discounting'.
      if (this.tracingOverheadDiscountedFromVmRegions_) return;
      this.tracingOverheadDiscountedFromVmRegions_ = true;

      var tracingDump = this.getMemoryAllocatorDumpByFullName('tracing');
      if (tracingDump === undefined) return;

      var discountedSize = getSizeNumericValue(tracingDump, SIZE_NUMERIC_NAME);
      var discountedResidentSize = getSizeNumericValue(tracingDump, RESIDENT_SIZE_NUMERIC_NAME);

      if (discountedSize <= 0 && discountedResidentSize <= 0) return;

      // Subtract the tracing size from the totals.
      if (this.totals !== undefined) {
        if (this.totals.residentBytes !== undefined) this.totals.residentBytes -= discountedResidentSize;
        if (this.totals.peakResidentBytes !== undefined) this.totals.peakResidentBytes -= discountedResidentSize;
      }

      // Subtract the tracing size from VM regions. More precisely, subtract
      // tracing resident_size from byte stats (private dirty and PSS) and
      // tracing size from virtual size by injecting a fake VM region with
      // negative values.
      if (this.vmRegions !== undefined) {
        var hasSizeInBytes = this.vmRegions.sizeInBytes !== undefined;
        var hasPrivateDirtyResident = this.vmRegions.byteStats.privateDirtyResident !== undefined;
        var hasProportionalResident = this.vmRegions.byteStats.proportionalResident !== undefined;

        if (hasSizeInBytes && discountedSize > 0 || (hasPrivateDirtyResident || hasProportionalResident) && discountedResidentSize > 0) {
          var byteStats = {};
          if (hasPrivateDirtyResident) byteStats.privateDirtyResident = -discountedResidentSize;
          if (hasProportionalResident) byteStats.proportionalResident = -discountedResidentSize;
          this.vmRegions.addRegion(tr.model.VMRegion.fromDict({
            mappedFile: '[discounted tracing overhead]',
            sizeInBytes: hasSizeInBytes ? -discountedSize : undefined,
            byteStats: byteStats
          }));
        }
      }
    }
  };

  ProcessMemoryDump.hookUpMostRecentVmRegionsLinks = function (processDumps) {
    var mostRecentVmRegions = undefined;

    processDumps.forEach(function (processDump) {
      // Update the most recent VM regions from the current dump.
      if (processDump.vmRegions !== undefined) mostRecentVmRegions = processDump.vmRegions;

      // Set the most recent VM regions of the current dump.
      processDump.mostRecentVmRegions = mostRecentVmRegions;
    });
  };

  tr.model.EventRegistry.register(ProcessMemoryDump, {
    name: 'processMemoryDump',
    pluralName: 'processMemoryDumps'
  });

  return {
    ProcessMemoryDump: ProcessMemoryDump
  };
});