"use strict";
/**
Copyright 2016 The Chromium Authors. All rights reserved.
Use of this source code is governed by a BSD-style license that can be
found in the LICENSE file.
**/

require("../../base/statistics.js");
require("../metric_registry.js");
require("./loading_metric.js");
require("../../value/histogram.js");

'use strict';

global.tr.exportTo('tr.metrics.sh', function () {

  // TODO(alexandermont): Per-frame power metric will be deprecated once
  // newer metrics come online.
  // Frame rate, used to divide power sample interval into frames
  // for purposes of per-frame power metric.
  var FRAMES_PER_SEC = 60;
  var FRAME_MS = tr.b.convertUnit(1.0 / FRAMES_PER_SEC, tr.b.UnitScale.Metric.NONE, tr.b.UnitScale.Metric.MILLI);

  /**
   * Returns power data for the specified interval in the form:
   * {
   *   duration: durationInMs,
   *   energy: energyInJ,
   *   power: powerInW
   * }
   */
  function getPowerData_(model, start, end) {
    var durationInMs = end - start;
    var durationInS = tr.b.convertUnit(durationInMs, tr.b.UnitScale.Metric.MILLI, tr.b.UnitScale.Metric.NONE);
    var energyInJ = model.device.powerSeries.getEnergyConsumedInJ(start, end);
    var powerInW = energyInJ / durationInS;
    return { duration: durationInMs, energy: energyInJ, power: powerInW };
  }

  // TODO(alexandermont): When LoadExpectation v1.0 is released,
  // update this function to use the new LoadExpectation rather
  // than calling loading_metric.html. If we set the end of the loading
  // RAIL stage to be the TTI, then we may not even need to treat the loading
  // events separately; we can just treat them like any other RAIL stage
  // (and the RAIL stage boundaries will be the intervals that we want.)
  /**
   * Returns the intervals of time between navigation event and time to
   * interactive.
   */
  function getNavigationTTIIntervals_(model) {
    var values = new tr.v.ValueSet();
    tr.metrics.sh.loadingMetric(values, model);
    var ttiValues = values.getValuesNamed('timeToFirstInteractive');
    var intervals = [];
    for (var bin of tr.b.getOnlyElement(ttiValues).allBins) {
      for (var diagnostics of bin.diagnosticMaps) {
        var breakdown = diagnostics.get('Navigation infos');
        intervals.push(tr.b.Range.fromExplicitRange(breakdown.value.start, breakdown.value.interactive));
      }
    }
    return intervals.sort((x, y) => x.min - y.min);
  }

  /**
   * Creates a histogram suitable for time data.
   */
  function makeTimeHistogram_(values, title, description) {
    var hist = new tr.v.Histogram(title + ':time', tr.b.Unit.byName.timeDurationInMs_smallerIsBetter);
    hist.customizeSummaryOptions({
      avg: false,
      count: false,
      max: true,
      min: true,
      std: false,
      sum: true
    });
    hist.description = 'Time spent in ' + description;
    values.addHistogram(hist);
    return hist;
  }

  /**
   * Creates a histogram suitable for energy data.
   */
  function makeEnergyHistogram_(values, title, description) {
    var hist = new tr.v.Histogram(title + ':energy', tr.b.Unit.byName.energyInJoules_smallerIsBetter);
    hist.customizeSummaryOptions({
      avg: false,
      count: false,
      max: true,
      min: true,
      std: false,
      sum: true
    });
    hist.description = 'Energy consumed in ' + description;
    values.addHistogram(hist);
    return hist;
  }

  /**
   * Creates a histogram suitable for power data.
   */
  function makePowerHistogram_(values, title, description) {
    var hist = new tr.v.Histogram(title + ':power', tr.b.Unit.byName.powerInWatts_smallerIsBetter);
    hist.customizeSummaryOptions({
      avg: true,
      count: false,
      max: true,
      min: true,
      std: false,
      sum: false
    });
    hist.description = 'Energy consumption rate in ' + description;
    values.addHistogram(hist);
    return hist;
  }

  /**
   * Stores the power data in data into the given histograms for time, energy,
   * and power. If a histogram is undefined then the corresponding type of
   * data is not stored.
   *
   * @param {!Object} data - Power data (obtained from getPowerData_)
   * @param {tr.v.Histogram} timeHist - Histogram to store time data.
   * @param {tr.v.Histogram} energyHist - Histogram to store energy data.
   * @param {tr.v.Histogram} powerHist - Histogram to store power data.
   */
  function storePowerData_(data, timeHist, energyHist, powerHist) {
    if (timeHist !== undefined) timeHist.addSample(data.duration);
    if (energyHist !== undefined) energyHist.addSample(data.energy);
    if (powerHist !== undefined) powerHist.addSample(data.power);
  }

  function createHistograms_(model, values) {
    var hists = {};

    // "Generic" RAIL stage metrics. These give time, energy, and power
    // for each RAIL stage, indexed by name. For instance, "Tap Animation"
    // is different from "Tap, Touch Animation". There is one histogram
    // for each RAIL stage name; if there are multiple RAIL stages with
    // the same name, these are different samples in the histogram.
    hists.railStageToTimeHist = new Map();
    hists.railStageToEnergyHist = new Map();
    hists.railStageToPowerHist = new Map();

    // Metrics for scrolling. A scroll stage is any stage with the
    // string "Scroll" in its name. For instance, "Scroll Response",
    // "Scroll Animation", and "Scroll, Touch Animation" are all
    // scroll stages. Histograms for scroll metrics contain one
    // sample for each scroll stage.
    hists.scrollTimeHist = makeTimeHistogram_(values, 'scroll', 'scrolling');
    hists.scrollEnergyHist = makeEnergyHistogram_(values, 'scroll', 'scrolling');
    hists.scrollPowerHist = makePowerHistogram_(values, 'scroll', 'scrolling');

    // Metrics for loading. Loading intervals are defined by the intervals
    // between navigation and TTI (time-to-interactive) given by
    // getNavigationTTIIntervals_. We also have a metric for the energy
    // consumed after load.
    hists.loadTimeHist = makeTimeHistogram_(values, 'load', 'page loads');
    hists.loadEnergyHist = makeEnergyHistogram_(values, 'load', 'page loads');
    hists.afterLoadTimeHist = makeTimeHistogram_(values, 'after_load', 'period after load');
    hists.afterLoadPowerHist = makePowerHistogram_(values, 'after_load', 'period after load');

    // Metrics for video. A video stage is any stage with the string "Video"
    // in its name. Histograms for video metrics contain one sample for each
    // video stage. Only power metrics are available for video stages.
    hists.videoPowerHist = makePowerHistogram_(values, 'video', 'video playback');

    // Frame based power metric.
    hists.frameEnergyHist = makeEnergyHistogram_(values, 'per_frame', 'each frame');

    for (var exp of model.userModel.expectations) {
      var currTitle = exp.title.toLowerCase().replace(' ', '_');
      // If we haven't seen a RAIL stage with this title before,
      // we have to create a new set of histograms for the "generic"
      // RAIL stage metrics.
      if (!hists.railStageToTimeHist.has(currTitle)) {
        var timeHist = makeTimeHistogram_(values, currTitle, 'RAIL stage ' + currTitle);

        var energyHist = makeEnergyHistogram_(values, currTitle, 'RAIL stage ' + currTitle);

        var powerHist = makePowerHistogram_(values, currTitle, 'RAIL stage ' + currTitle);

        hists.railStageToTimeHist.set(currTitle, timeHist);
        hists.railStageToEnergyHist.set(currTitle, energyHist);
        hists.railStageToPowerHist.set(currTitle, powerHist);
      }
    }
    return hists;
  }

  /**
   * Process a single interaction record (RAIL stage) for power metric
   * purposes. This function only keeps track of metrics that are based
   * on the start and end time of the RAIL stages.
   */
  function processInteractionRecord_(exp, model, hists) {
    var currTitle = exp.title.toLowerCase().replace(' ', '_');
    var data = getPowerData_(model, exp.start, exp.end);

    // Add the samples for the "generic" RAIL stage metrics.
    storePowerData_(data, hists.railStageToTimeHist.get(currTitle), hists.railStageToEnergyHist.get(currTitle), hists.railStageToPowerHist.get(currTitle));

    // If this is a scroll stage, add the sample for the scroll metrics.
    if (exp.title.indexOf("Scroll") !== -1) {
      storePowerData_(data, hists.scrollTimeHist, hists.scrollEnergyHist, hists.scrollPowerHist);
    }

    // If this is a video stage, add the sample for the video metrics.
    if (exp.title.indexOf("Video") !== -1) storePowerData_(data, undefined, undefined, hists.videoPowerHist);
  }

  /**
   * Compute the loading power metric from the model and put the results
   * in |hists|. Note that this is not in processInteractionRecord_ because
   * the loading metric intervals don't correspond exactly to the RAIL stages.
   */
  function computeLoadingMetric_(model, hists) {
    var intervals = getNavigationTTIIntervals_(model);
    var lastLoadTime = undefined;
    for (var interval of intervals) {
      var loadData = getPowerData_(model, interval.min, interval.max);
      storePowerData_(loadData, hists.loadTimeHist, hists.loadEnergyHist, undefined);
      lastLoadTime = lastLoadTime == undefined ? interval.max : Math.max(lastLoadTime, interval.max);
    }
    if (lastLoadTime !== undefined) {
      var afterLoadData = getPowerData_(model, lastLoadTime, model.bounds.max);
      storePowerData_(afterLoadData, hists.afterLoadTimeHist, undefined, hists.afterLoadPowerHist);
    }
  }

  /**
   * Compute the per-frame power metrics and put the results in |hists|.
   */
  function computeFrameBasedPowerMetric_(model, hists) {
    model.device.powerSeries.updateBounds();
    var currentTime = model.device.powerSeries.bounds.min;
    while (currentTime < model.device.powerSeries.bounds.max) {
      var frameData = getPowerData_(model, currentTime, currentTime + FRAME_MS);
      hists.frameEnergyHist.addSample(frameData.energy);
      currentTime += FRAME_MS;
    }
  }

  function powerMetric(values, model) {
    if (!model.device.powerSeries) return;

    var hists = createHistograms_(model, values);
    for (var exp of model.userModel.expectations) processInteractionRecord_(exp, model, hists);

    // The following two metrics aren't based directly on the IR intervals,
    // and so need to be computed outside the processInteractionRecord_ loop.
    computeLoadingMetric_(model, hists);
    computeFrameBasedPowerMetric_(model, hists);
  }

  tr.metrics.MetricRegistry.register(powerMetric);

  return {
    powerMetric: powerMetric
  };
});