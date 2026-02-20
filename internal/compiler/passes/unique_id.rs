// Copyright © SixtyFPS GmbH <info@slint.dev>
// SPDX-License-Identifier: GPL-3.0-only OR LicenseRef-Slint-Royalty-free-2.0 OR LicenseRef-Slint-Software-3.0

use crate::diagnostics::{BuildDiagnostics, Spanned};
use crate::langtype::ElementType;
use crate::object_tree::*;
use smol_str::{SmolStr, ToSmolStr, format_smolstr};
use std::collections::HashMap;
use std::rc::Rc;

/// This pass make sure that the id of the elements are unique
///
/// It currently does so by adding a number to the existing id
pub fn assign_unique_id(doc: &Document) {
    let mut count = 0;
    doc.visit_all_used_components(|component| {
        if !component.is_global() {
            assign_unique_id_in_component(component, &mut count)
        }
    });
    rename_globals(doc, count);
}

fn assign_unique_id_in_component(component: &Rc<Component>, count: &mut u32) {
    recurse_elem_including_sub_components(component, &(), &mut |elem, _| {
        *count += 1;
        let mut elem_mut = elem.borrow_mut();
        let old_id = if !elem_mut.id.is_empty() {
            elem_mut.id.clone()
        } else {
            elem_mut.base_type.to_smolstr().to_ascii_lowercase().into()
        };
        elem_mut.id = format_smolstr!("{}-{}", old_id, count);

        let enclosing = elem_mut.enclosing_component.upgrade().unwrap();
        if Rc::ptr_eq(elem, &enclosing.root_element) {
            for o in enclosing.optimized_elements.borrow().iter() {
                *count += 1;
                let mut elem_mut = o.borrow_mut();
                elem_mut.id = format_smolstr!("optimized-{}-{}", elem_mut.id, count);
            }
        }
    });
}

/// Give globals unique name
fn rename_globals(doc: &Document, mut count: u32) {
    for g in &doc.used_types.borrow().globals {
        count += 1;
        let mut root = g.root_element.borrow_mut();
        if matches!(&root.base_type, ElementType::Builtin(_)) {
            // builtin global keeps its name
            root.id.clone_from(&g.id);
        } else if let Some(s) = g.exported_global_names.borrow().first() {
            root.id = s.to_smolstr();
        } else if g.from_library.get() {
            root.id = format_smolstr!("{}", g.id);
        } else {
            root.id = format_smolstr!("{}-{}", g.id, count);
        }
    }
}

/// Checks that all ids in the Component are unique
pub fn check_unique_id(doc: &Document, diag: &mut BuildDiagnostics) {
    for component in &doc.inner_components {
        check_unique_id_in_component(component, diag);
    }
}

fn check_unique_id_in_component(component: &Rc<Component>, diag: &mut BuildDiagnostics) {
    let mut seen_ids: HashMap<SmolStr, ElementRc> = HashMap::new();

    recurse_elem(&component.root_element, &(), &mut |elem, _| {
        let elem_bor = elem.borrow();
        let id = &elem_bor.id;
        if !id.is_empty() {
            if let Some(first_elem) = seen_ids.get(id) {
                debug_assert!(!Rc::ptr_eq(first_elem, elem));
                let message = format!("duplicated element id '{id}'");
                diag.push_error(message, &*elem_bor);
                // Point note to the id token of the first element, not its type name
                let first_id_loc = first_elem
                    .borrow()
                    .debug
                    .first()
                    .and_then(|d| d.node.parent())
                    .and_then(|p| p.child_token(crate::parser::SyntaxKind::Identifier))
                    .map(|t| t.to_source_location());
                if let Some(span) = first_id_loc {
                    diag.push_note_with_span("Id first defined here".into(), span);
                } else {
                    diag.push_note("Id first defined here".into(), &*first_elem.borrow());
                }
            } else {
                seen_ids.insert(id.clone(), elem.clone());
            }
        }
    })
}
