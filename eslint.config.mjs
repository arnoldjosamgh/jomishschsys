import globals from "globals";

export default [
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        io: "readonly",
        jsPDF: "readonly",
        jspdf: "readonly",
        Quagga: "readonly",
        Chart: "readonly"
      }
    },
    rules: {
      "no-undef": "warn",
      "no-unused-vars": "warn"
    }
  }
];
