/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
    {
      name: 'renderer-must-not-import-electron-main',
      severity: 'error',
      from: { path: '^src' },
      to: { path: '^electron' },
    },
    {
      name: 'electron-must-not-import-renderer',
      severity: 'error',
      from: { path: '^electron' },
      to: { path: '^src/(components|stores|assets)' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    includeOnly: '^src|^electron',
    tsConfig: {
      fileName: 'tsconfig.json',
    },
    reporterOptions: {
      dot: {
        collapsePattern: 'node_modules/[^/]+',
      },
    },
  },
};
