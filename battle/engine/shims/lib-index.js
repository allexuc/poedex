// Showdown の lib/index の代わり：シミュレーターが使う Streams と Utils だけを出す
// （本物は net・repl・子プロセスなど、ブラウザにない機能も読み込むため）
import * as Streams from 'ps/dist/lib/streams.js';
import * as Utils from 'ps/dist/lib/utils.js';
export { Streams, Utils };
