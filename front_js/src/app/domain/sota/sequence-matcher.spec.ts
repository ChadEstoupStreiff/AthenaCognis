import { sequenceRatio } from './sequence-matcher';

/** Golden values computed with Python's `difflib.SequenceMatcher(None, a, b).ratio()` (random cases use seed 7). */
const GOLDEN: [string, string, number][] = [
  ['abcd', 'bcde', 0.75],
  ['', '', 1.0],
  ['abc', '', 0.0],
  ['attention is all you need', 'attention is not all you need', 0.9259259259259259],
  ['qabxcd', 'abycdf', 0.6666666666666666],
  ['a comprehensive survey', 'a comprehensiv survey', 0.9767441860465116],
  [
    'bcaaa abaaccabacaabacabab cba bab aaabcc cc  bbba c c aacb bccaa   ccaa caa c c ac bacab bbcccabcc bc c cbbabbbbacb  abc',
    'cddcbdda d    a  abab bacdaaadbdacdaabd bccdc aa    cabacc bdabdcbdadcacdcbcbdddcbdbb bbd caac cbdc ccabab bcb dda caa b ',
    0.29045643153526973,
  ],
  ['c acccabbbabcbc bbaaabcbba b b', 'dccd bac dd dbdbdda bdabbb dadacd', 0.2857142857142857],
  [
    'aabb aacaac b ccb bcbcacc abcab ab b bcbaccbbbcc cb  a a ccac  aabaa  ab bc cbc a abca aa aba aca c babab abb  b cb  a aaabcbcaccc bb bbc abaa cbaac b acbb ca    ba b ba cac bbaa abcaca  babc cb bacbabaaab accaabc acaaac a bbbcccac abab   bacac abc  cccab aca ',
    'ad c bbadabdccbddcacb   aba   cb c cacacc abaccca  dac cacaacbbc dcbc a ddbaa  dbc adbb  ccccc bc d abbabd db c  bdbbabcdacbccdba   db cca cdcbddbacb    caba  d aa d  babbbda adaabbdacbcd aaacddb cbdaadc ccb dbdba caab  acb cb ac c bacdab bcbb bccad dbb  adb a',
    0.0038461538461538464,
  ],
  ['abcaabcc aab bbca c  cbaaa a c', 'db cc aa bcd bcc a b a a aa', 0.49122807017543857],
  [
    'ba    a    aaabaccc ccbcba bb  c abcbbcaac bcaa abacccbbbccba       bcbbbbb b ac bbacaaacbc a baabba bc aa ba  bab aba c',
    'cbdcaba d a a dbdab c cc acdc  acb  ba b aa dc bbaadb addcdbbccbdbaa  bcba cad adbbd db bdba db cabbbadaca d dc cdb  c d b',
    0.21487603305785125,
  ],
  ['accbc', 'd b  aab', 0.3076923076923077],
  [
    'c acaaba aacbaaabbc bba  b  cb cb b  abbcb  cb aa ca c  c b  acbba    aabb cc abcbaaaa  a bc bb cbbabbcaab c aa ccbbaaaa',
    'bbbaaaddbb bddd dbdcaca da   a bbacbaaccacd dccbadabcbbbcb cdb d  daa bdcb ddadbbaaaadbcbaaabaaaadcbda abbbaaaac ababccc',
    0.24166666666666667,
  ],
  [
    ' a   a  c acaca caba bcab aa cacbc  b bbcbaaca  accaca b  cbcbcba  bc bcc bb cbb  bbb  bb b ababcbb  c baa bccaaccb cab cabccbbbacc  acbcb cccacb accaa bbb acbca  ccbbca a  ccaaacc  ab cbccbbbabcbb cc bc b c cbca  b  ccca b caa b aaba  abbbc bbcba bcbacaa cbbc',
    'da  b b bddabc d c c  abcaadacad  bab bcacc ddbc c cdaccc  cdcdcb acbccbdaa d dda caaab daddd dbdaba baba aacbcdccb aca dda ddaa d  aa ddb  daa bba aaaabab acdb bacbacd  caaaaada ccdb daccd  bbacb    cdcccaddcdabdcd b   db caccc bdacbdbcd cdadd  bbcda  bcda  d',
    0.0,
  ],
  [' abc ', 'dc ddbbb', 0.3076923076923077],
  ['ab   cbbac a cab a  aaabcb  ca', 'ddbcacbb aaaadc  ad aaccdbad b', 0.43333333333333335],
  [
    'b bbba  aaa caab ab cac   ca ccbcbbacbabba bcacaac  bca b babcbcb ccbba   b ca ccababc a b c bbac cba bac bca b cacb bbbbbbaac bbbb baaca   caaccb bb ab a caa b ca accabababbba  aaab acbca aba acc aaacbbbbccbaccaca  cb c ca b bca aba cbabbcccaaa  aa aacba a  b',
    'addca ddb adbc dccbadc ddb bdc dcd  cabcbbdd d acbbcdc ccbcaabdadc ad  cadbb ccbbddcda cb aa dda  db cdda   cccc ddd ca   cbdcb d dbaccdbcb aaacd cdcdd dd   cadc aadba cd ddbb    ddcdabcccacdbaccd bdcdbdb baddacda aacdac adaabb ddcddbdb dabbddaaaabd  d aadc',
    0.0,
  ],
  ['b  ba aa bccaabcacabbbabb ac c', 'c ab db c  ababbc bac dcacd c a', 0.45901639344262296],
  [
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaabbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    0.0,
  ],
];

describe('sequenceRatio', () => {
  it.each(GOLDEN)('matches difflib for %j / %j', (left, right, expected) => {
    expect(sequenceRatio(left, right)).toBeCloseTo(expected, 12);
  });
});
