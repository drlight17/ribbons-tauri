//! KDE global shortcuts via the native KGlobalAccel service.
//!
//! tauri-plugin-global-shortcut uses X11 key grabs on Linux, which are not
//! system-wide under a Wayland session. KDE Plasma (5 and 6) exposes its
//! KGlobalAccel service over D-Bus; registering the actions there lets KWin
//! deliver them regardless of the session type.

use futures_util::StreamExt;
use tauri::AppHandle;

use crate::logging::write_log;

const SERVICE: &str = "org.kde.kglobalaccel";
const OBJECT: &str = "/kglobalaccel";
const INTERFACE: &str = "org.kde.KGlobalAccel";
const COMPONENT: &str = "com.electron.ribbons-tauri";

// Qt key codes used by KGlobalAccel. QKeySequence is always serialized as a
// four-int array, with 0 as padding.
const CTRL_P: i32 = 0x0400_0050; // Qt::ControlModifier | Qt::Key_P
const ALT_SHIFT_ESCAPE: i32 = 0x0B00_0000; // Alt | Shift | Qt::Key_Escape

// KGlobalAccel::SetShortcutFlag::SetPresent and IsDefault.
const FLAG_SET_PRESENT: u32 = 2;
const FLAG_IS_DEFAULT: u32 = 8;

struct ActionSpec {
    unique: &'static str,
    key: i32,
}

const ACTIONS: [ActionSpec; 2] = [
    ActionSpec {
        unique: "pause",
        key: CTRL_P,
    },
    ActionSpec {
        unique: "restart",
        key: ALT_SHIFT_ESCAPE,
    },
];

fn action_id(action: &ActionSpec, action_friendly: &str, component_friendly: &str) -> Vec<String> {
    vec![
        COMPONENT.to_string(),
        action.unique.to_string(),
        component_friendly.to_string(),
        action_friendly.to_string(),
    ]
}

fn keys(value: i32) -> Vec<(Vec<i32>,)> {
    vec![(vec![value, 0, 0, 0],)]
}

pub fn start(app: AppHandle, pause_label: String, restart_label: String) {
    tauri::async_runtime::spawn(async move {
        if let Err(err) = run(&app, &pause_label, &restart_label).await {
            write_log(
                &app,
                format!("KDE global shortcut registration failed: {err}"),
            );
            // Last resort: the X11 plugin still covers X11 sessions and other
            // desktops, even if it cannot grab keys on Wayland.
            crate::register_plugin_shortcuts(&app);
        }
    });
}

async fn run(app: &AppHandle, pause_label: &str, restart_label: &str) -> zbus::Result<()> {
    let connection = zbus::Connection::session().await?;
    let proxy = zbus::Proxy::new(&connection, SERVICE, OBJECT, INTERFACE).await?;
    let component_friendly = app.package_info().name.clone();

    for action in &ACTIONS {
        let label = if action.unique == "pause" {
            pause_label
        } else {
            restart_label
        };
        let id = action_id(action, label, &component_friendly);
        proxy.call::<_, _, ()>("doRegister", &(id.clone(),)).await?;

        let existing: Vec<(Vec<i32>,)> = proxy
            .call("shortcutKeys", &(id.clone(),))
            .await
            .unwrap_or_default();
        let configured = existing
            .iter()
            .any(|(sequence,)| sequence.iter().any(|value| *value != 0));

        if configured {
            write_log(
                app,
                format!(
                    "KDE shortcut {} already configured: {existing:?}",
                    action.unique
                ),
            );
            continue;
        }

        let key_list = keys(action.key);
        // The canonical client sends both the active and the default binding.
        let active: Vec<(Vec<i32>,)> = proxy
            .call(
                "setShortcutKeys",
                &(id.clone(), key_list.clone(), FLAG_SET_PRESENT),
            )
            .await?;
        let _: Vec<(Vec<i32>,)> = proxy
            .call("setShortcutKeys", &(id, key_list, FLAG_IS_DEFAULT))
            .await?;
        write_log(
            app,
            format!("KDE shortcut {} registered: {active:?}", action.unique),
        );
    }

    let component_path: zbus::zvariant::OwnedObjectPath =
        proxy.call("getComponent", &(COMPONENT,)).await?;
    let component = zbus::Proxy::new(
        &connection,
        SERVICE,
        component_path.as_str(),
        "org.kde.kglobalaccel.Component",
    )
    .await?;
    let mut stream = component.receive_signal("globalShortcutPressed").await?;

    write_log(app, "KDE global shortcuts are active");
    while let Some(message) = stream.next().await {
        let Ok((component_unique, action_unique, _timestamp)) =
            message.body().deserialize::<(String, String, i64)>()
        else {
            continue;
        };
        if component_unique != COMPONENT {
            continue;
        }
        match action_unique.as_str() {
            "pause" => crate::windows::toggle_all(app),
            "restart" => crate::autostart::restart_app(app),
            _ => {}
        }
    }
    Ok(())
}
