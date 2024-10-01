describe("Homepage tests", () => {
  it("Console is cleared of errors and warnings", () => {
    cy.visit("/", {
      onBeforeLoad(win) {
        cy.stub(win.console, "error").as("consoleError");
      },
    });
    cy.get("@consoleError").should("not.be.called");
    cy.get("body").should("exist");
    cy.get("h1").should("exist");
  });
});
