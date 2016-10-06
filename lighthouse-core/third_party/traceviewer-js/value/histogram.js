"use strict";
/**
Copyright 2016 The Chromium Authors. All rights reserved.
Use of this source code is governed by a BSD-style license that can be
found in the LICENSE file.
**/

var _slicedToArray = function () { function sliceIterator(arr, i) { var _arr = []; var _n = true; var _d = false; var _e = undefined; try { for (var _i = arr[Symbol.iterator](), _s; !(_n = (_s = _i.next()).done); _n = true) { _arr.push(_s.value); if (i && _arr.length === i) break; } } catch (err) { _d = true; _e = err; } finally { try { if (!_n && _i["return"]) _i["return"](); } finally { if (_d) throw _e; } } return _arr; } return function (arr, i) { if (Array.isArray(arr)) { return arr; } else if (Symbol.iterator in Object(arr)) { return sliceIterator(arr, i); } else { throw new TypeError("Invalid attempt to destructure non-iterable instance"); } }; }();

require("../base/iteration_helpers.js");
require("../base/range.js");
require("../base/running_statistics.js");
require("../base/sorted_array_utils.js");
require("../base/statistics.js");
require("../base/unit.js");
require("./diagnostics/diagnostic_map.js");
require("./numeric.js");

'use strict';

global.tr.exportTo('tr.v', function () {
  var MAX_DIAGNOSTIC_MAPS = 16;

  var DEFAULT_BOUNDARIES_FOR_UNIT = new Map();

  class HistogramBin {
    /**
     * @param {!tr.b.Range} range
     */
    constructor(range) {
      this.range = range;
      this.count = 0;
      this.diagnosticMaps = [];
    }

    /**
     * @param {*} value
     */
    addSample(value) {
      this.count += 1;
    }

    /**
     * @param {!tr.v.d.DiagnosticMap} diagnostics
     */
    addDiagnosticMap(diagnostics) {
      tr.b.Statistics.uniformlySampleStream(this.diagnosticMaps, this.count, diagnostics, MAX_DIAGNOSTIC_MAPS);
    }

    addBin(other) {
      if (!this.range.equals(other.range)) throw new Error('Merging incompatible Histogram bins.');
      tr.b.Statistics.mergeSampledStreams(this.diagnosticMaps, this.count, other.diagnosticMaps, other.count, MAX_DIAGNOSTIC_MAPS);
      this.count += other.count;
    }

    fromDict(dict) {
      this.count = dict[0];
      if (dict.length > 1) {
        for (var map of dict[1]) {
          this.diagnosticMaps.push(tr.v.d.DiagnosticMap.fromDict(map));
        }
      }
    }

    asDict() {
      if (!this.diagnosticMaps.length) {
        return [this.count];
      }
      // It's more efficient to serialize these 2 fields in an array. If you
      // add any other fields, you should re-evaluate whether it would be more
      // efficient to serialize as a dict.
      return [this.count, this.diagnosticMaps.map(d => d.asDict())];
    }
  }

  var DEFAULT_SUMMARY_OPTIONS = new Map([['avg', true], ['geometricMean', false], ['std', true], ['count', true], ['sum', true], ['min', true], ['max', true], ['nans', false]]);

  /**
   * This is basically a histogram, but so much more.
   * Histogram is serializable using asDict/fromDict.
   * Histogram computes several statistics of its contents.
   * Histograms can be merged.
   * getDifferenceSignificance() test whether one Histogram is statistically
   * significantly different from another Histogram.
   * Histogram stores a random sample of the exact number values added to it.
   * Histogram stores a random sample of optional per-sample DiagnosticMaps.
   * Histogram is visualized by <tr-v-ui-histogram-span>, which supports
   * selecting bins, and visualizing the DiagnosticMaps of selected bins.
   *
   * @param {!tr.b.Unit} unit
   * @param {!tr.v.HistogramBinBoundaries=} opt_binBoundaries
   */
  class Histogram {
    constructor(name, unit, opt_binBoundaries) {
      var binBoundaries = opt_binBoundaries;
      if (!binBoundaries) {
        var baseUnit = unit.baseUnit ? unit.baseUnit : unit;
        binBoundaries = DEFAULT_BOUNDARIES_FOR_UNIT.get(baseUnit.unitName);
      }

      // If this Histogram is being deserialized, then its guid will be set by
      // fromDict().
      // If this Histogram is being computed by a metric, then its guid will be
      // allocated the first time the guid is gotten by asDict().
      this.guid_ = undefined;

      // Serialize binBoundaries here instead of holding a reference to it in
      // case it is modified.
      this.binBoundariesDict_ = binBoundaries.asDict();

      this.centralBins = [];
      this.description = '';
      this.diagnostics = new tr.v.d.DiagnosticMap();
      this.maxCount_ = 0;
      this.name_ = name;
      this.nanDiagnosticMaps = [];
      this.numNans = 0;
      this.running = new tr.b.RunningStatistics();
      this.sampleValues_ = [];
      this.shortName = undefined;
      this.summaryOptions = new Map(DEFAULT_SUMMARY_OPTIONS);
      this.summaryOptions.set('percentile', []);
      this.unit = unit;

      this.underflowBin = new HistogramBin(tr.b.Range.fromExplicitRange(-Number.MAX_VALUE, binBoundaries.range.min));
      this.overflowBin = new HistogramBin(tr.b.Range.fromExplicitRange(binBoundaries.range.max, Number.MAX_VALUE));

      for (var range of binBoundaries.binRanges()) {
        this.centralBins.push(new HistogramBin(range));
      }

      this.allBins = [this.underflowBin];
      for (var bin of this.centralBins) this.allBins.push(bin);
      this.allBins.push(this.overflowBin);

      this.maxNumSampleValues_ = this.defaultMaxNumSampleValues_;
    }

    get maxNumSampleValues() {
      return this.maxNumSampleValues_;
    }

    set maxNumSampleValues(n) {
      this.maxNumSampleValues_ = n;
      tr.b.Statistics.uniformlySampleArray(this.sampleValues_, this.maxNumSampleValues_);
    }

    get name() {
      return this.name_;
    }

    get guid() {
      if (this.guid_ === undefined) this.guid_ = tr.b.GUID.allocateUUID4();

      return this.guid_;
    }

    set guid(guid) {
      if (this.guid_ !== undefined) throw new Error('Cannot reset guid');

      this.guid_ = guid;
    }

    static fromDict(dict) {
      var hist = new Histogram(dict.name, tr.b.Unit.fromJSON(dict.unit), HistogramBinBoundaries.fromDict(dict.binBoundaries));
      hist.guid = dict.guid;
      if (dict.shortName) {
        hist.shortName = dict.shortName;
      }
      if (dict.description) {
        hist.description = dict.description;
      }
      if (dict.diagnostics) {
        hist.diagnostics.addDicts(dict.diagnostics);
      }
      if (dict.underflowBin) {
        hist.underflowBin.fromDict(dict.underflowBin);
      }
      if (dict.overflowBin) {
        hist.overflowBin.fromDict(dict.overflowBin);
      }
      if (dict.centralBins) {
        if (dict.centralBins.length !== undefined) {
          for (var i = 0; i < dict.centralBins.length; ++i) {
            hist.centralBins[i].fromDict(dict.centralBins[i]);
          }
        } else {
          tr.b.iterItems(dict.centralBins, (i, binDict) => {
            hist.centralBins[i].fromDict(binDict);
          });
        }
      }
      for (var bin of hist.allBins) {
        hist.maxCount_ = Math.max(hist.maxCount_, bin.count);
      }
      if (dict.running) {
        hist.running = tr.b.RunningStatistics.fromDict(dict.running);
      }
      if (dict.summaryOptions) {
        hist.customizeSummaryOptions(dict.summaryOptions);
      }
      if (dict.maxNumSampleValues !== undefined) {
        hist.maxNumSampleValues = dict.maxNumSampleValues;
      }
      if (dict.sampleValues) {
        hist.sampleValues_ = dict.sampleValues;
      }
      if (dict.numNans) {
        hist.numNans = dict.numNans;
      }
      if (dict.nanDiagnostics) {
        for (var map of dict.nanDiagnostics) {
          hist.nanDiagnosticMaps.push(tr.v.d.DiagnosticMap.fromDict(map));
        }
      }
      return hist;
    }

    /**
     * Build a Histogram from a set of samples in order to effectively merge a
     * set of ScalarNumerics.
     * The range of the resulting histogram is determined by the smallest and
     * largest sample value, which is unpredictable.
     * https://github.com/catapult-project/catapult/issues/2685
     *
     * @param {!tr.b.Unit} unit
     * @param {!Array.<number>} samples
     * @return {!Histogram}
     */
    static buildFromSamples(unit, samples) {
      var boundaries = HistogramBinBoundaries.createFromSamples(samples);
      var result = new Histogram(unit, boundaries);
      result.maxNumSampleValues = 1000;

      // TODO(eakuefner): Propagate diagnosticMaps?
      for (var sample of samples) result.addSample(sample);

      return result;
    }

    get numValues() {
      return tr.b.Statistics.sum(this.allBins, function (e) {
        return e.count;
      });
    }

    get average() {
      return this.running.mean;
    }

    get standardDeviation() {
      return this.running.stddev;
    }

    get geometricMean() {
      return this.running.geometricMean;
    }

    get sum() {
      return this.running.sum;
    }

    get maxCount() {
      return this.maxCount_;
    }

    /**
     * Requires that units agree.
     * Returns DONT_CARE if that is the units' improvementDirection.
     * Returns SIGNIFICANT if the Mann-Whitney U test returns a
     * p-value less than opt_alpha or DEFAULT_ALPHA. Returns INSIGNIFICANT if
     * the p-value is greater than alpha.
     *
     * @param {!tr.v.Histogram} other
     * @param {number=} opt_alpha
     * @return {!tr.b.Statistics.Significance}
     */
    getDifferenceSignificance(other, opt_alpha) {
      if (this.unit !== other.unit) throw new Error('Cannot compare Numerics with different units');

      if (this.unit.improvementDirection === tr.b.ImprovementDirection.DONT_CARE) {
        return tr.b.Statistics.Significance.DONT_CARE;
      }

      if (!(other instanceof Histogram)) throw new Error('Unable to compute a p-value');

      var testResult = tr.b.Statistics.mwu(this.sampleValues, other.sampleValues, opt_alpha);
      return testResult.significance;
    }

    /*
     * Compute an approximation of percentile based on the counts in the bins.
     * If the real percentile lies within |this.range| then the result of
     * the function will deviate from the real percentile by at most
     * the maximum width of the bin(s) within which the point(s)
     * from which the real percentile would be calculated lie.
     * If the real percentile is outside |this.range| then the function
     * returns the closest range limit: |this.range.min| or |this.range.max|.
     *
     * @param {number} percent The percent must be between 0.0 and 1.0.
     */
    getApproximatePercentile(percent) {
      if (!(percent >= 0 && percent <= 1)) throw new Error('percent must be [0,1]');
      if (this.numValues == 0) return 0;
      var valuesToSkip = Math.floor((this.numValues - 1) * percent);
      for (var i = 0; i < this.allBins.length; i++) {
        var bin = this.allBins[i];
        valuesToSkip -= bin.count;
        if (valuesToSkip < 0) {
          if (bin === this.underflowBin) return bin.range.max;else if (bin === this.overflowBin) return bin.range.min;else return bin.range.center;
        }
      }
      throw new Error('Unreachable');
    }

    getBinForValue(value) {
      // Don't use subtraction to avoid arithmetic overflow.
      var binIndex = tr.b.findHighIndexInSortedArray(this.allBins, b => value < b.range.max ? -1 : 1);
      return this.allBins[binIndex] || this.overflowBin;
    }

    /**
     * @param {number|*} value
     * @param {(!Object|!tr.v.d.DiagnosticMap)=} opt_diagnostics
     */
    addSample(value, opt_diagnostics) {
      if (opt_diagnostics && !(opt_diagnostics instanceof tr.v.d.DiagnosticMap)) opt_diagnostics = tr.v.d.DiagnosticMap.fromObject(opt_diagnostics);

      if (typeof value !== 'number' || isNaN(value)) {
        this.numNans++;
        if (opt_diagnostics) {
          tr.b.Statistics.uniformlySampleStream(this.nanDiagnosticMaps, this.numNans, opt_diagnostics, MAX_DIAGNOSTIC_MAPS);
        }
      } else {
        this.running.add(value);

        var bin = this.getBinForValue(value);
        bin.addSample(value);
        if (opt_diagnostics) bin.addDiagnosticMap(opt_diagnostics);
        if (bin.count > this.maxCount_) this.maxCount_ = bin.count;
      }

      tr.b.Statistics.uniformlySampleStream(this.sampleValues_, this.numValues + this.numNans, value, this.maxNumSampleValues);
    }

    sampleValuesInto(samples) {
      for (var sampleValue of this.sampleValues) samples.push(sampleValue);
    }

    /**
     * Return true if this Histogram can be added to |other|.
     *
     * @param {!tr.v.Histogram} other
     * @return {boolean}
     */
    canAddHistogram(other) {
      if (this.unit !== other.unit) return false;
      if (this.allBins.length !== other.allBins.length) return false;

      for (var i = 0; i < this.allBins.length; ++i) if (!this.allBins[i].range.equals(other.allBins[i].range)) return false;

      return true;
    }

    /**
     * Add |other| to this Histogram in-place if they can be added.
     *
     * @param {!tr.v.Histogram} other
     */
    addHistogram(other) {
      if (!this.canAddHistogram(other)) {
        throw new Error('Merging incompatible Histograms');
      }

      tr.b.Statistics.mergeSampledStreams(this.nanDiagnosticMaps, this.numNans, other.nanDiagnosticMaps, other.numNans, MAX_DIAGNOSTIC_MAPS);
      tr.b.Statistics.mergeSampledStreams(this.sampleValues, this.numValues, other.sampleValues, other.numValues, tr.b.Statistics.mean([this.maxNumSampleValues, other.maxNumSampleValues]));
      this.numNans += other.numNans;
      this.running = this.running.merge(other.running);
      for (var i = 0; i < this.allBins.length; ++i) {
        this.allBins[i].addBin(other.allBins[i]);
      }
    }

    /**
     * Controls which statistics are exported to dashboard for this numeric.
     * The |summaryOptions| parameter is a dictionary with optional boolean
     * fields |count|, |sum|, |avg|, |std|, |min|, |max| and an optional
     * array field |percentile|.
     * Each percentile should be a number between 0.0 and 1.0.
     * The options not included in the |summaryOptions| will not change.
     */
    customizeSummaryOptions(summaryOptions) {
      tr.b.iterItems(summaryOptions, (key, value) => this.summaryOptions.set(key, value));
    }

    /**
     * Returns a Map {statisticName: ScalarNumeric}.
     *
     * Each enabled summary option produces the corresponding value:
     * min, max, count, sum, avg, or std.
     * Each percentile 0.x produces pct_0x0.
     * Each percentile 0.xx produces pct_0xx.
     * Each percentile 0.xxy produces pct_0xx_y.
     * Percentile 1.0 produces pct_100.
     *
     * @return {!Map.<string, ScalarNumeric>}
     */
    get statisticsScalars() {
      function statNameToKey(stat) {
        switch (stat) {
          case 'std':
            return 'stddev';
          case 'avg':
            return 'mean';
        }
        return stat;
      }
      /**
       * Converts the given percent to a string in the format specified above.
       * @param {number} percent The percent must be between 0.0 and 1.0.
       */
      function percentToString(percent) {
        if (percent < 0 || percent > 1) throw new Error('Percent must be between 0.0 and 1.0');
        switch (percent) {
          case 0:
            return '000';
          case 1:
            return '100';
        }
        var str = percent.toString();
        if (str[1] !== '.') throw new Error('Unexpected percent');
        // Pad short strings with zeros.
        str = str + '0'.repeat(Math.max(4 - str.length, 0));
        if (str.length > 4) str = str.slice(0, 4) + '_' + str.slice(4);
        return '0' + str.slice(2);
      }

      var results = new Map();
      for (var _ref of this.summaryOptions) {
        var _ref2 = _slicedToArray(_ref, 2);

        var stat = _ref2[0];
        var option = _ref2[1];

        if (!option) {
          continue;
        }

        if (stat === 'percentile') {
          for (var percent of option) {
            var percentile = this.getApproximatePercentile(percent);
            results.set('pct_' + percentToString(percent), new tr.v.ScalarNumeric(this.unit, percentile));
          }
        } else if (stat === 'nans') {
          results.set('nans', new tr.v.ScalarNumeric(tr.b.Unit.byName.count_smallerIsBetter, this.numNans));
        } else {
          var statUnit = stat === 'count' ? tr.b.Unit.byName.count_smallerIsBetter : this.unit;
          var key = statNameToKey(stat);
          var statValue = this.running[key];

          if (typeof statValue === 'number') {
            results.set(stat, new tr.v.ScalarNumeric(statUnit, statValue));
          }
        }
      }
      return results;
    }

    get sampleValues() {
      return this.sampleValues_;
    }

    /**
     * Create a new Histogram object that is exactly the same as this one, with
     * this Histogram's name, unit, and binBoundaries, guid, bin counts, and
     * diagnostics.
     * @return {!tr.v.Histogram}
     */
    clone() {
      return Histogram.fromDict(this.asDict());
    }

    /**
     * Create a new Histogram with this Histogram's name, unit, and
     * binBoundaries, but not its guid, bin counts, or diagnostics.
     * @return {!tr.v.Histogram}
     */
    cloneEmpty() {
      var binBoundaries = HistogramBinBoundaries.fromDict(this.binBoundariesDict_);
      return new Histogram(this.name, this.unit, binBoundaries);
    }

    asDict() {
      var dict = {};
      dict.binBoundaries = this.binBoundariesDict_;
      dict.name = this.name;
      dict.unit = this.unit.asJSON();
      dict.guid = this.guid;
      if (this.shortName) {
        dict.shortName = this.shortName;
      }
      if (this.description) {
        dict.description = this.description;
      }
      if (this.diagnostics.size) {
        dict.diagnostics = this.diagnostics.asDict();
      }
      if (this.maxNumSampleValues !== this.defaultMaxNumSampleValues_) {
        dict.maxNumSampleValues = this.maxNumSampleValues;
      }
      if (this.numNans) {
        dict.numNans = this.numNans;
      }
      if (this.nanDiagnosticMaps.length) {
        dict.nanDiagnostics = this.nanDiagnosticMaps.map(dm => dm.asDict());
      }
      if (this.underflowBin.count) {
        dict.underflowBin = this.underflowBin.asDict();
      }
      if (this.overflowBin.count) {
        dict.overflowBin = this.overflowBin.asDict();
      }

      if (this.numValues) {
        dict.sampleValues = this.sampleValues.slice();
        dict.running = this.running.asDict();
        dict.centralBins = this.centralBinsAsDict_();
      }

      var summaryOptions = {};
      var anyOverriddenSummaryOptions = false;
      for (var _ref3 of this.summaryOptions) {
        var _ref4 = _slicedToArray(_ref3, 2);

        var name = _ref4[0];
        var option = _ref4[1];

        if (name === 'percentile') {
          if (option.length === 0) {
            continue;
          }
          option = option.slice();
        } else if (option === DEFAULT_SUMMARY_OPTIONS.get(name)) {
          continue;
        }
        summaryOptions[name] = option;
        anyOverriddenSummaryOptions = true;
      }
      if (anyOverriddenSummaryOptions) {
        dict.summaryOptions = summaryOptions;
      }

      return dict;
    }

    centralBinsAsDict_() {
      // dict.centralBins may be either an array or a dict, whichever is more
      // efficient.
      // The overhead of the array form is significant when the histogram is
      // sparse, and the overhead of the dict form is significant when the
      // histogram is dense.
      // The dict form is more efficient when more than half of centralBins are
      // empty. The array form is more efficient when fewer than half of
      // centralBins are empty.

      var numCentralBins = this.centralBins.length;

      // If all centralBins are empty, then don't serialize anything for them.
      var emptyBins = 0;

      for (var i = 0; i < numCentralBins; ++i) {
        if (this.centralBins[i].count === 0) {
          ++emptyBins;
        }
      }

      if (emptyBins === numCentralBins) {
        return undefined;
      }

      if (emptyBins > numCentralBins / 2) {
        var centralBinsDict = {};
        for (var i = 0; i < numCentralBins; ++i) {
          var bin = this.centralBins[i];
          if (bin.count > 0) {
            centralBinsDict[i] = bin.asDict();
          }
        }
        return centralBinsDict;
      }

      var centralBinsArray = [];
      for (var i = 0; i < numCentralBins; ++i) {
        centralBinsArray.push(this.centralBins[i].asDict());
      }
      return centralBinsArray;
    }

    get defaultMaxNumSampleValues_() {
      return this.allBins.length * 10;
    }
  }

  var HISTOGRAM_BIN_BOUNDARIES_CACHE = new Map();

  /**
   * Reusable builder for tr.v.Histogram objects.
   *
   * The bins of the numeric are specified by adding the desired boundaries
   * between bins. Initially, the builder has only a single boundary:
   *
   *            range.min=range.max
   *                     |
   *                     |
   *   -MAX_INT <--------|------------------------------------------> +MAX_INT
   *       :  resulting  :                   resulting                    :
   *       :  underflow  :                    overflow                    :
   *       :     bin     :                      bin                       :
   *
   * More boundaries can be added (in increasing order) using addBinBoundary,
   * addLinearBins and addExponentialBins:
   *
   *                range.min                           range.max
   *                     |         |         |     |         |
   *                     |         |         |     |         |
   *   -MAX_INT <--------|---------|---------|-----|---------|------> +MAX_INT
   *       :  resulting  : result. : result. :     : result. : resulting  :
   *       :  underflow  : central : central : ... : central :  overflow  :
   *       :     bin     :  bin 0  :  bin 1  :     : bin N-1 :    bin     :
   *
   * An important feature of the builder is that it's reusable, i.e. it can be
   * used to build multiple numerics with the same unit and bin structure.
   *
   */
  class HistogramBinBoundaries {
    /**
     * Create a linearly scaled tr.v.HistogramBinBoundaries with |numBins| bins
     * ranging from |min| to |max|.
     *
     * @param {number} min
     * @param {number} max
     * @param {number} numBins
     * @return {tr.v.HistogramBinBoundaries}
     */
    static createLinear(min, max, numBins) {
      return new HistogramBinBoundaries(min).addLinearBins(max, numBins);
    }

    /**
     * Create an exponentially scaled tr.v.HistogramBinBoundaries with |numBins|
     * bins ranging from |min| to |max|.
     *
     * @param {number} min
     * @param {number} max
     * @param {number} numBins
     * @return {tr.v.HistogramBinBoundaries}
     */
    static createExponential(min, max, numBins) {
      return new HistogramBinBoundaries(min).addExponentialBins(max, numBins);
    }

    /**
     * @param {Array.<number>} binBoundaries
     */
    static createWithBoundaries(binBoundaries) {
      var builder = new HistogramBinBoundaries(binBoundaries[0]);
      for (var boundary of binBoundaries.slice(1)) builder.addBinBoundary(boundary);
      return builder;
    }

    static createFromSamples(samples) {
      var range = new tr.b.Range();
      // Prevent non-numeric samples from introducing NaNs into the range.
      for (var sample of samples) if (!isNaN(Math.max(sample))) range.addValue(sample);

      // HistogramBinBoundaries.addLinearBins() requires this.
      if (range.isEmpty) range.addValue(1);
      if (range.min === range.max) range.addValue(range.min - 1);

      // This optimizes the resolution when samples are uniformly distributed
      // (which is almost never the case).
      var numBins = Math.ceil(Math.sqrt(samples.length));
      var builder = new HistogramBinBoundaries(range.min);
      builder.addLinearBins(range.max, numBins);
      return builder;
    }

    /**
     * @param {number} minBinBoundary The minimum boundary between bins, namely
     *     the underflow bin and the first central bin (or the overflow bin if
     *     no other boundaries are added later).
     */
    constructor(minBinBoundary) {
      this.boundaries_ = undefined;
      this.builder_ = [minBinBoundary];
      this.range_ = new tr.b.Range();
      this.range_.addValue(minBinBoundary);
    }

    get range() {
      return this.range_;
    }

    asDict() {
      // Copy builder_ in case ours is modified later.
      return this.builder_.slice();
    }

    static fromDict(dict) {
      // When loading a results2.html with many Histograms with the same bin
      // boundaries, caching the HistogramBinBoundaries not only speeds up
      // loading, but also prevents a bug where build_ is occasionally
      // non-deterministic, which causes similar Histograms to be unmergeable.
      var cacheKey = JSON.stringify(dict);
      if (HISTOGRAM_BIN_BOUNDARIES_CACHE.has(cacheKey)) {
        return HISTOGRAM_BIN_BOUNDARIES_CACHE.get(cacheKey);
      }

      var binBoundaries = new HistogramBinBoundaries(dict[0]);
      for (var slice of dict.slice(1)) {
        if (!(slice instanceof Array)) {
          binBoundaries.addBinBoundary(slice);
          continue;
        }
        switch (slice[0]) {
          case HistogramBinBoundaries.SLICE_TYPE.LINEAR:
            binBoundaries.addLinearBins(slice[1], slice[2]);
            break;

          case HistogramBinBoundaries.SLICE_TYPE.EXPONENTIAL:
            binBoundaries.addExponentialBins(slice[1], slice[2]);
            break;

          default:
            throw new Error('Unrecognized HistogramBinBoundaries slice type');
        }
      }
      HISTOGRAM_BIN_BOUNDARIES_CACHE.set(cacheKey, binBoundaries);
      return binBoundaries;
    }

    /**
     * Yield Ranges of adjacent boundaries.
     */
    *binRanges() {
      if (this.boundaries_ === undefined) {
        this.build_();
      }
      for (var i = 0; i < this.boundaries_.length - 1; ++i) {
        yield tr.b.Range.fromExplicitRange(this.boundaries_[i], this.boundaries_[i + 1]);
      }
    }

    build_() {
      if (typeof this.builder_[0] !== 'number') {
        throw new Error('Invalid start of builder_');
      }
      this.boundaries_ = [this.builder_[0]];

      for (var slice of this.builder_.slice(1)) {
        if (!(slice instanceof Array)) {
          this.boundaries_.push(slice);
          continue;
        }
        var nextMaxBinBoundary = slice[1];
        var binCount = slice[2];
        var curMaxBinBoundary = this.boundaries_[this.boundaries_.length - 1];

        switch (slice[0]) {
          case HistogramBinBoundaries.SLICE_TYPE.LINEAR:
            var binWidth = (nextMaxBinBoundary - curMaxBinBoundary) / binCount;
            for (var i = 1; i < binCount; i++) {
              var boundary = curMaxBinBoundary + i * binWidth;
              this.boundaries_.push(boundary);
            }
            break;

          case HistogramBinBoundaries.SLICE_TYPE.EXPONENTIAL:
            var binExponentWidth = Math.log(nextMaxBinBoundary / curMaxBinBoundary) / binCount;
            for (var i = 1; i < binCount; i++) {
              var boundary = curMaxBinBoundary * Math.exp(i * binExponentWidth);
              this.boundaries_.push(boundary);
            }
            break;

          default:
            throw new Error('Unrecognized HistogramBinBoundaries slice type');
        }
        this.boundaries_.push(nextMaxBinBoundary);
      }
    }

    /**
     * Add a bin boundary |nextMaxBinBoundary| to the builder.
     *
     * This operation effectively corresponds to appending a new central bin
     * with the range [this.range.max, nextMaxBinBoundary].
     *
     * @param {number} nextMaxBinBoundary The added bin boundary (must be
     *     greater than |this.maxMinBoundary|).
     */
    addBinBoundary(nextMaxBinBoundary) {
      if (nextMaxBinBoundary <= this.range.max) {
        throw new Error('The added max bin boundary must be larger than ' + 'the current max boundary');
      }

      // If boundaries_ had been built, then clear them.
      this.boundaries_ = undefined;

      this.builder_.push(nextMaxBinBoundary);
      this.range.addValue(nextMaxBinBoundary);
      return this;
    }

    /**
     * Add |binCount| linearly scaled bin boundaries up to |nextMaxBinBoundary|
     * to the builder.
     *
     * This operation corresponds to appending |binCount| central bins of
     * constant range width
     * W = ((|nextMaxBinBoundary| - |this.range.max|) / |binCount|)
     * with the following ranges:
     *
     *   [|this.maxMinBoundary|, |this.maxMinBoundary| + W]
     *   [|this.maxMinBoundary| + W, |this.maxMinBoundary| + 2W]
     *   [|this.maxMinBoundary| + 2W, |this.maxMinBoundary| + 3W]
     *   ...
     *   [|this.maxMinBoundary| + (|binCount| - 2) * W,
     *    |this.maxMinBoundary| + (|binCount| - 2) * W]
     *   [|this.maxMinBoundary| + (|binCount| - 1) * W,
     *    |nextMaxBinBoundary|]
     *
     * @param {number} nextBinBoundary The last added bin boundary (must be
     *     greater than |this.maxMinBoundary|).
     * @param {number} binCount Number of bins to be added (must be positive).
     */
    addLinearBins(nextMaxBinBoundary, binCount) {
      if (binCount <= 0) throw new Error('Bin count must be positive');

      if (nextMaxBinBoundary <= this.range.max) {
        throw new Error('The new max bin boundary must be greater than ' + 'the previous max bin boundary');
      }

      // If boundaries_ had been built, then clear them.
      this.boundaries_ = undefined;

      this.builder_.push([HistogramBinBoundaries.SLICE_TYPE.LINEAR, nextMaxBinBoundary, binCount]);
      this.range.addValue(nextMaxBinBoundary);
      return this;
    }

    /**
     * Add |binCount| exponentially scaled bin boundaries up to
     * |nextMaxBinBoundary| to the builder.
     *
     * This operation corresponds to appending |binCount| central bins with
     * a constant difference between the logarithms of their range min and max
     * D = ((ln(|nextMaxBinBoundary|) - ln(|this.range.max|)) / |binCount|)
     * with the following ranges:
     *
     *   [|this.maxMinBoundary|, |this.maxMinBoundary| * exp(D)]
     *   [|this.maxMinBoundary| * exp(D), |this.maxMinBoundary| * exp(2D)]
     *   [|this.maxMinBoundary| * exp(2D), |this.maxMinBoundary| * exp(3D)]
     *   ...
     *   [|this.maxMinBoundary| * exp((|binCount| - 2) * D),
     *    |this.maxMinBoundary| * exp((|binCount| - 2) * D)]
     *   [|this.maxMinBoundary| * exp((|binCount| - 1) * D),
     *    |nextMaxBinBoundary|]
     *
     * This method requires that the current max bin boundary is positive.
     *
     * @param {number} nextBinBoundary The last added bin boundary (must be
     *     greater than |this.maxMinBoundary|).
     * @param {number} binCount Number of bins to be added (must be positive).
     */
    addExponentialBins(nextMaxBinBoundary, binCount) {
      if (binCount <= 0) {
        throw new Error('Bin count must be positive');
      }
      if (this.range.max <= 0) {
        throw new Error('Current max bin boundary must be positive');
      }
      if (this.range.max >= nextMaxBinBoundary) {
        throw new Error('The last added max boundary must be greater than ' + 'the current max boundary boundary');
      }

      // If boundaries_ had been built, then clear them.
      this.boundaries_ = undefined;

      this.builder_.push([HistogramBinBoundaries.SLICE_TYPE.EXPONENTIAL, nextMaxBinBoundary, binCount]);
      this.range.addValue(nextMaxBinBoundary);
      return this;
    }
  }

  HistogramBinBoundaries.SLICE_TYPE = {
    LINEAR: 0,
    EXPONENTIAL: 1
  };

  DEFAULT_BOUNDARIES_FOR_UNIT.set(tr.b.Unit.byName.timeDurationInMs.unitName, HistogramBinBoundaries.createExponential(1e-3, 1e6, 1e2));

  DEFAULT_BOUNDARIES_FOR_UNIT.set(tr.b.Unit.byName.timeStampInMs.unitName, HistogramBinBoundaries.createLinear(0, 1e10, 1e3));

  DEFAULT_BOUNDARIES_FOR_UNIT.set(tr.b.Unit.byName.normalizedPercentage.unitName, HistogramBinBoundaries.createLinear(0, 1.0, 20));

  DEFAULT_BOUNDARIES_FOR_UNIT.set(tr.b.Unit.byName.sizeInBytes.unitName, HistogramBinBoundaries.createExponential(1, 1e12, 1e2));

  DEFAULT_BOUNDARIES_FOR_UNIT.set(tr.b.Unit.byName.energyInJoules.unitName, HistogramBinBoundaries.createExponential(1e-3, 1e3, 50));

  DEFAULT_BOUNDARIES_FOR_UNIT.set(tr.b.Unit.byName.powerInWatts.unitName, HistogramBinBoundaries.createExponential(1e-3, 1, 50));

  DEFAULT_BOUNDARIES_FOR_UNIT.set(tr.b.Unit.byName.unitlessNumber.unitName, HistogramBinBoundaries.createExponential(1e-3, 1e3, 50));

  DEFAULT_BOUNDARIES_FOR_UNIT.set(tr.b.Unit.byName.count.unitName, HistogramBinBoundaries.createExponential(1, 1e3, 20));

  return {
    Histogram: Histogram,
    HistogramBinBoundaries: HistogramBinBoundaries
  };
});