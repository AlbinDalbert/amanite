mod ai_adapter;
mod catalog;
mod drafts;
mod fractal_adapter;
mod platform;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    dotenvy::dotenv().ok();
    let builder = tauri::Builder::default().plugin(tauri_plugin_dialog::init());
    #[cfg(feature = "webdriver")]
    let builder = builder.plugin(tauri_plugin_wdio_webdriver::init());

    builder
        .invoke_handler(tauri::generate_handler![
            ai_adapter::ai_list_models,
            ai_adapter::ai_chat,
            fractal_adapter::fractal_list_projects,
            fractal_adapter::fractal_inspect_project,
            fractal_adapter::fractal_recover_project,
            fractal_adapter::fractal_repair_project,
            fractal_adapter::fractal_recreate_page,
            drafts::fractal_list_drafts,
            drafts::fractal_read_draft,
            drafts::fractal_write_draft,
            drafts::fractal_move_draft,
            drafts::fractal_delete_draft,
            fractal_adapter::fractal_create_project,
            fractal_adapter::fractal_open_project,
            fractal_adapter::fractal_open_project_path,
            fractal_adapter::fractal_open_page,
            fractal_adapter::fractal_read_page,
            fractal_adapter::fractal_set_page_title,
            fractal_adapter::fractal_set_page_content,
            fractal_adapter::fractal_set_page_style,
            fractal_adapter::fractal_set_page_metadata,
            fractal_adapter::fractal_repair_page_structure,
            fractal_adapter::fractal_search_project,
            fractal_adapter::fractal_page_content_states,
            fractal_adapter::fractal_export_html,
            fractal_adapter::fractal_export_folder_html,
            platform::fractal_reveal_page,
            platform::fractal_open_external,
            fractal_adapter::fractal_create_page,
            fractal_adapter::fractal_duplicate_page,
            fractal_adapter::fractal_create_folder,
            fractal_adapter::fractal_set_folder_title,
            fractal_adapter::fractal_reorder_folder,
            fractal_adapter::fractal_delete_folder,
            fractal_adapter::fractal_move_page,
            fractal_adapter::fractal_delete_page,
            fractal_adapter::fractal_validate_project,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Amanite");
}

#[cfg(test)]
mod tests {
    #[test]
    fn application_registers_every_expected_command_once() {
        let source = include_str!("lib.rs");
        let expected = [
            "ai_list_models",
            "ai_chat",
            "fractal_list_projects",
            "fractal_inspect_project",
            "fractal_recover_project",
            "fractal_repair_project",
            "fractal_recreate_page",
            "fractal_list_drafts",
            "fractal_read_draft",
            "fractal_write_draft",
            "fractal_move_draft",
            "fractal_delete_draft",
            "fractal_create_project",
            "fractal_open_project",
            "fractal_open_project_path",
            "fractal_open_page",
            "fractal_read_page",
            "fractal_set_page_title",
            "fractal_set_page_content",
            "fractal_set_page_style",
            "fractal_set_page_metadata",
            "fractal_repair_page_structure",
            "fractal_search_project",
            "fractal_page_content_states",
            "fractal_export_html",
            "fractal_export_folder_html",
            "fractal_reveal_page",
            "fractal_open_external",
            "fractal_create_page",
            "fractal_duplicate_page",
            "fractal_create_folder",
            "fractal_set_folder_title",
            "fractal_reorder_folder",
            "fractal_delete_folder",
            "fractal_move_page",
            "fractal_delete_page",
            "fractal_validate_project",
        ];

        for command in expected {
            assert_eq!(
                source.matches(&format!("::{command},")).count(),
                1,
                "{command} must be registered exactly once"
            );
        }
    }
}
