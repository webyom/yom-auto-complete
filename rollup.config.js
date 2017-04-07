import mt2amd from 'rollup-plugin-mt2amd';

export default {
  entry: 'src/yom-auto-complete.js',
  format: 'umd',
  moduleName: 'YomAutoComplete',
  plugins: [mt2amd()],
  external: ['jquery'],
  globals: {jquery: '$'},
  dest: 'dist/yom-auto-complete.js'
};