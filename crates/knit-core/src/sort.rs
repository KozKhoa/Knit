use std::cmp::Ordering;

/// So sánh tự nhiên (Natural Sort) không phân biệt hoa thường:
/// `"chap 2"` < `"Chap 10"`, `"1.5"` < `"1.10"`.
pub fn natural_cmp(a: &str, b: &str) -> Ordering {
    let mut ia = a.chars().peekable();
    let mut ib = b.chars().peekable();

    loop {
        match (ia.peek(), ib.peek()) {
            (None, None) => return Ordering::Equal,
            (None, Some(_)) => return Ordering::Less,
            (Some(_), None) => return Ordering::Greater,
            (Some(&ca), Some(&cb)) => {
                if ca.is_ascii_digit() && cb.is_ascii_digit() {
                    let na = take_digits(&mut ia);
                    let nb = take_digits(&mut ib);
                    // So sánh giá trị số nguyên không phụ thuộc số lượng số 0 đầu,
                    // nếu bằng nhau thì số ít chữ số hơn đứng trước ("2" < "02")
                    let trimmed_a = na.trim_start_matches('0');
                    let trimmed_b = nb.trim_start_matches('0');
                    let ord = trimmed_a
                        .len()
                        .cmp(&trimmed_b.len())
                        .then_with(|| trimmed_a.cmp(trimmed_b))
                        .then_with(|| na.len().cmp(&nb.len()));
                    if ord != Ordering::Equal {
                        return ord;
                    }
                } else {
                    ia.next();
                    ib.next();
                    let la = ca.to_lowercase();
                    let lb = cb.to_lowercase();
                    let ord = la.cmp(lb);
                    if ord != Ordering::Equal {
                        return ord;
                    }
                }
            }
        }
    }
}

fn take_digits(it: &mut std::iter::Peekable<std::str::Chars<'_>>) -> String {
    let mut s = String::new();
    while let Some(&c) = it.peek() {
        if c.is_ascii_digit() {
            s.push(c);
            it.next();
        } else {
            break;
        }
    }
    s
}

/// Sắp xếp slice theo khóa chuỗi dùng `natural_cmp`.
pub fn natural_sort_by<T, F>(items: &mut [T], mut key_fn: F)
where
    F: FnMut(&T) -> &str,
{
    items.sort_by(|a, b| natural_cmp(key_fn(a), key_fn(b)));
}
