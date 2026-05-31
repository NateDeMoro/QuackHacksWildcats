import type { ChannelDescriptor, EventSample, SignalChannel, Transcript } from '@quack/shared';

/** Descriptor for the filler channel derived from the transcript's disfluent words. */
export const fillerDescriptor: ChannelDescriptor = {
  id: 'audio.filler',
  modality: 'audio',
  signal: 'filler',
  unit: 'count',
};

/**
 * Build the `audio.filler` channel from a transcript. Each word flagged `isDisfluency` (tagged by
 * the API's filler lexicon) becomes one filler EventSample.
 *
 * use when: after STT returns, before summarizing — append the result to the SessionRecord's
 * channels so the filler summarizer surfaces the count and timing.
 */
export function buildFillerChannel(transcript: Transcript): SignalChannel<EventSample> {
  const series: EventSample[] = transcript.words
    .filter((w) => w.isDisfluency)
    .map((w) => ({
      t: w.tStartMs,
      d: Math.max(0, w.tEndMs - w.tStartMs),
      kind: 'filler',
      payload: { word: w.text },
    }));
  return { descriptor: fillerDescriptor, series };
}
