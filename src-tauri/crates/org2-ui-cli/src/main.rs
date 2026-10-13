fn main() {
    std::process::exit(org2_ui_cli::run(std::env::args().skip(1).collect()));
}
